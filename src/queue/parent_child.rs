//! Shared parent/child job machinery for photo background workers.
//!
//! Background workers that may need to process hundreds of thousands of
//! photos are split into a parent `*_scan` job (which enumerates pending
//! photo IDs and enqueues one child job per photo) and the child jobs
//! themselves. The parent transitions
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
use crate::repos::PhotoLibraryRepo;
use crate::services::notifications as photo_notify;
use crate::db::repos::job_repo::JobRepo;

type DynErr = Box<dyn std::error::Error + Send + Sync>;

/// Build the parent data JSON returned to the worker. Includes the magic
/// `_phase: "waiting"` key so the worker calls `mark_waiting`.
fn parent_data_waiting(total: i64, library_name: &str, task_type: &str) -> JsonValue {
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
/// enqueue one child job per photo, and return a data blob that flips
/// the parent into `waiting` state. Idempotent: on retry it detects the
/// `totalChildren` field already set by a prior partial run and skips
/// re-enqueueing children.
pub async fn run_scan<F>(
    db: &DatabaseConnection,
    state: &Arc<AppState>,
    job_id: Uuid,
    params: &JsonValue,
    user_id: Option<Uuid>,
    task_type: &str,
    child_job_type: &str,
    list_pending_ids: F,
) -> Result<Option<JsonValue>, DynErr>
where
    F: AsyncFnOnce(Uuid) -> Result<Vec<Uuid>, crate::error::AppError>,
{
    let app_id = params
        .get("photoLibraryId")
        .and_then(|v| v.as_str())
        .ok_or("Missing photoLibraryId in params")?;
    let app_uuid = Uuid::parse_str(app_id)?;
    let lib_name = library_name(db, app_uuid).await;

    // Idempotency: if a previous (crashed) run already enqueued children,
    // skip the enqueue phase and just transition to waiting again.
    if let Ok(Some(self_job)) = crate::db::entities::jobs::Entity::find_by_id(job_id).one(db).await
        && self_job.data.as_ref().and_then(|d| d.get("totalChildren")).is_some()
    {
        info!("[{task_type}_scan] resuming parent {job_id}: children already enqueued");
        let total = self_job
            .data
            .as_ref()
            .and_then(|d| d.get("totalChildren"))
            .and_then(serde_json::Value::as_i64)
            .unwrap_or(0);
        if total == 0 {
            return Ok(Some(json!({ "processed": 0, "libraryName": lib_name })));
        }
        return Ok(Some(parent_data_waiting(total, &lib_name, task_type)));
    }

    let pending = list_pending_ids(app_uuid).await?;
    let total = pending.len() as i64;
    info!("[{task_type}_scan] {total} pending photos for app {app_uuid}");
    if total == 0 {
        if let Some(uid) = user_id {
            // Surface "nothing to do" as a completion notification (count=0)
            // so the user gets an immediate ack instead of silence.
            photo_notify::notify_processing_completed(state, uid, app_uuid, &lib_name, task_type, 0).await;
        }
        return Ok(Some(json!({
            "processed": 0,
            "libraryName": lib_name,
        })));
    }

    // One child job per photo. parentJobId + taskType travel in the params
    // so the dispatch can surface them to child
    // handlers. They are ALSO persisted into dedicated `parent_job_id` and
    // `task_type` columns (via create_child_jobs_batch) so DB queries can
    // rely on stable indexed columns even if handlers overwrite `data`.
    let children: Vec<_> = pending
        .iter()
        .map(|photo_id| {
            let params = json!({
                "photoLibraryId": app_uuid.to_string(),
                "photoId": photo_id.to_string(),
                "libraryName": lib_name,
                "parentJobId": job_id.to_string(),
                "taskType": task_type,
            });
            (
                child_job_type,
                params,
                None::<JsonValue>,
                user_id,
                job_id,
                task_type.to_string(),
            )
        })
        .collect();
    let inserted = JobRepo::create_child_jobs_batch(db, children, None).await?;
    info!("[{task_type}_scan] enqueued {inserted} child jobs (one per photo)");

    // Fire an immediate 0/total progress notification so the user sees the
    // task in their notification center right away.
    if let Some(uid) = user_id {
        photo_notify::notify_processing_progress(state, uid, app_uuid, &lib_name, task_type, 0, total).await;
    }

    Ok(Some(parent_data_waiting(total, &lib_name, task_type)))
}

/// Extract `(photoLibraryId, photoId, libraryName, parentJobId, taskType)` from a
/// child job's params. Returns parsed UUIDs.
pub struct ChildContext {
    pub app_id: Uuid,
    pub photo_id: Uuid,
    pub library_name: String,
    pub parent_job_id: Uuid,
    pub task_type: String,
}

pub fn parse_child_params(params: &JsonValue) -> Result<ChildContext, DynErr> {
    let app_id = params
        .get("photoLibraryId")
        .and_then(|v| v.as_str())
        .ok_or("Missing photoLibraryId in child params")?;
    let app_uuid = Uuid::parse_str(app_id)?;

    let photo_id_str = params
        .get("photoId")
        .and_then(|v| v.as_str())
        .ok_or("Missing photoId in child params")?;
    let photo_id = Uuid::parse_str(photo_id_str)?;

    let library_name = params
        .get("libraryName")
        .and_then(|v| v.as_str())
        .unwrap_or(app_id)
        .to_string();
    let parent_id = params
        .get("parentJobId")
        .and_then(|v| v.as_str())
        .ok_or("Missing parentJobId in child params")?;
    let parent_job_id = Uuid::parse_str(parent_id)?;
    let task_type = params
        .get("taskType")
        .and_then(|v| v.as_str())
        .unwrap_or("photo_unknown")
        .to_string();

    Ok(ChildContext {
        app_id: app_uuid,
        photo_id,
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
    // Aggregate with the current child biased in — the worker hasn't yet
    // marked this child `completed`/`failed` in the DB, so the raw count
    // is always off by one. We know this child's outcome here, so inject
    // it directly to keep the parent's progress/status accurate.
    let pending_s = i32::try_from(success).unwrap_or(i32::MAX);
    let pending_f = i32::try_from(failures).unwrap_or(i32::MAX);
    let agg = JobRepo::aggregate_parent_progress(db, ctx.parent_job_id, pending_s, pending_f).await?;
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
    Ok(Some(json!({
        "parentJobId": ctx.parent_job_id.to_string(),
        "taskType": ctx.task_type,
        "processed": success,
        "failed": failures,
    })))
}
