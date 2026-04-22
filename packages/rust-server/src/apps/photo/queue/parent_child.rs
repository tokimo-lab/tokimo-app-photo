//! Shared parent/child job machinery for photo background workers.
//!
//! Background workers that may need to process hundreds of thousands of
//! photos are split into a parent `*_scan` job (which enumerates pending
//! photo IDs and enqueues many small `*_batch` child jobs) and the child
//! batch jobs themselves. The parent transitions
//! `pending → running → waiting → completed` via the queue framework's
//! `_phase: "waiting"` magic key, and child jobs aggregate their results
//! back onto the parent via `JobRepo::aggregate_parent_progress`.
//!
//! This module factors out the wiring that's common across the four
//! photo task types (OCR / CLIP / face / geocode).

use std::sync::Arc;

use sea_orm::{DatabaseConnection, EntityTrait};
use serde_json::{Value as JsonValue, json};
use tracing::info;
use uuid::Uuid;

use crate::AppState;
use crate::apps::photo::repos::PhotoLibraryRepo;
use crate::apps::photo::services::notifications as photo_notify;
use crate::db::repos::job_repo::JobRepo;

type DynErr = Box<dyn std::error::Error + Send + Sync>;

/// Build the parent meta JSON returned to the worker. Includes the magic
/// `_phase: "waiting"` key so the worker calls `mark_waiting`.
fn parent_meta_waiting(total: i64, library_name: &str, task_type: &str) -> JsonValue {
    json!({
        "_phase": "waiting",
        "totalChildren": total,
        "done": 0,
        "successes": 0,
        "failures": 0,
        "libraryName": library_name,
        "taskType": task_type,
    })
}

/// Resolve a photo library's display name (falls back to the UUID string).
async fn library_name(db: &DatabaseConnection, app_uuid: Uuid) -> String {
    PhotoLibraryRepo::get_by_id(db, app_uuid)
        .await
        .ok()
        .flatten()
        .map_or_else(|| app_uuid.to_string(), |m| m.name)
}

/// Run the "scan" half of a parent/child photo job: list pending photo IDs,
/// chunk them into child `*_batch` jobs, and return a meta blob that flips
/// the parent into `waiting` state. Idempotent: on retry it detects the
/// `totalChildren` field already set by a prior partial run and skips
/// re-enqueueing children.
#[allow(clippy::too_many_arguments)]
pub async fn run_scan<F>(
    db: &DatabaseConnection,
    state: &Arc<AppState>,
    job_id: Uuid,
    payload: &JsonValue,
    user_id: Option<Uuid>,
    task_type: &str,
    child_job_type: &str,
    batch_size: usize,
    list_pending_ids: F,
) -> Result<Option<JsonValue>, DynErr>
where
    F: AsyncFnOnce(Uuid) -> Result<Vec<Uuid>, crate::error::AppError>,
{
    let app_id = payload
        .get("appId")
        .and_then(|v| v.as_str())
        .ok_or("Missing appId in payload")?;
    let app_uuid = Uuid::parse_str(app_id)?;
    let lib_name = library_name(db, app_uuid).await;

    // Idempotency: if a previous (crashed) run already enqueued children,
    // skip the enqueue phase and just transition to waiting again.
    if let Ok(Some(self_job)) = crate::db::entities::jobs::Entity::find_by_id(job_id)
        .one(db)
        .await
        && let Some(meta) = &self_job.meta
        && meta.get("totalChildren").is_some()
    {
        info!("[{task_type}_scan] resuming parent {job_id}: children already enqueued");
        let total = meta
            .get("totalChildren")
            .and_then(serde_json::Value::as_i64)
            .unwrap_or(0);
        if total == 0 {
            return Ok(Some(json!({ "processed": 0, "libraryName": lib_name })));
        }
        return Ok(Some(parent_meta_waiting(total, &lib_name, task_type)));
    }

    let pending = list_pending_ids(app_uuid).await?;
    let total = pending.len() as i64;
    info!("[{task_type}_scan] {total} pending photos for app {app_uuid}");
    if total == 0 {
        if let Some(uid) = user_id {
            // Surface "nothing to do" as a completion notification (count=0)
            // so the user gets an immediate ack instead of silence.
            photo_notify::notify_processing_completed(state, uid, app_uuid, &lib_name, task_type, 0)
                .await;
        }
        return Ok(Some(json!({
            "processed": 0,
            "libraryName": lib_name,
        })));
    }

    // Chunk into child batches and bulk-insert. parentJobId + taskType
    // travel in the payload so the dispatch (which doesn't pass meta) can
    // surface them to child handlers.
    let mut children = Vec::with_capacity(pending.len().div_ceil(batch_size));
    for chunk in pending.chunks(batch_size) {
        let payload = json!({
            "appId": app_uuid.to_string(),
            "photoIds": chunk.iter().map(Uuid::to_string).collect::<Vec<_>>(),
            "libraryName": lib_name,
            "parentJobId": job_id.to_string(),
            "taskType": task_type,
        });
        let meta = json!({
            "parentJobId": job_id.to_string(),
            "taskType": task_type,
        });
        children.push((child_job_type, payload, Some(meta), user_id));
    }
    let inserted = JobRepo::create_jobs_batch(db, children).await?;
    info!("[{task_type}_scan] enqueued {inserted} child jobs (batch={batch_size})");

    // Fire an immediate 0/total progress notification so the user sees the
    // task in their notification center right away — children may take
    // minutes per batch, so waiting for the first finalize_child would feel
    // like the trigger silently failed.
    if let Some(uid) = user_id {
        photo_notify::notify_processing_progress(
            state, uid, app_uuid, &lib_name, task_type, 0, total,
        )
        .await;
    }

    Ok(Some(parent_meta_waiting(total, &lib_name, task_type)))
}

/// Extract `(appId, photoIds, libraryName, parentJobId, taskType)` from a
/// child batch job's payload + meta blob. Returns parsed UUIDs.
pub struct ChildContext {
    pub app_id: Uuid,
    pub photo_ids: Vec<Uuid>,
    pub library_name: String,
    pub parent_job_id: Uuid,
    pub task_type: String,
}

pub fn parse_child_payload(payload: &JsonValue) -> Result<ChildContext, DynErr> {
    let app_id = payload
        .get("appId")
        .and_then(|v| v.as_str())
        .ok_or("Missing appId in child payload")?;
    let app_uuid = Uuid::parse_str(app_id)?;

    let ids_array = payload
        .get("photoIds")
        .and_then(|v| v.as_array())
        .ok_or("Missing photoIds in child payload")?;
    let mut photo_ids = Vec::with_capacity(ids_array.len());
    for v in ids_array {
        let s = v.as_str().ok_or("photoIds entry is not a string")?;
        photo_ids.push(Uuid::parse_str(s)?);
    }

    let library_name = payload
        .get("libraryName")
        .and_then(|v| v.as_str())
        .unwrap_or(app_id)
        .to_string();
    let parent_id = payload
        .get("parentJobId")
        .and_then(|v| v.as_str())
        .ok_or("Missing parentJobId in child payload")?;
    let parent_job_id = Uuid::parse_str(parent_id)?;
    let task_type = payload
        .get("taskType")
        .and_then(|v| v.as_str())
        .unwrap_or("photo_unknown")
        .to_string();

    Ok(ChildContext {
        app_id: app_uuid,
        photo_ids,
        library_name,
        parent_job_id,
        task_type,
    })
}

/// After processing, aggregate to parent and dispatch progress / completion
/// notifications for the user.
pub async fn finalize_child(
    db: &DatabaseConnection,
    state: &Arc<AppState>,
    user_id: Option<Uuid>,
    ctx: &ChildContext,
    success: u32,
    failures: u32,
) -> Result<Option<JsonValue>, DynErr> {
    let agg = JobRepo::aggregate_parent_progress(db, ctx.parent_job_id).await?;
    if let (Some(uid), Some(a)) = (user_id, agg) {
        if a.completed {
            photo_notify::notify_processing_completed(
                state,
                uid,
                ctx.app_id,
                &ctx.library_name,
                &ctx.task_type,
                i64::from(a.successes),
            )
            .await;
        } else {
            photo_notify::notify_processing_progress(
                state,
                uid,
                ctx.app_id,
                &ctx.library_name,
                &ctx.task_type,
                i64::from(a.done),
                i64::from(a.total_children),
            )
            .await;
        }
    }
    Ok(Some(json!({ "processed": success, "failed": failures })))
}
