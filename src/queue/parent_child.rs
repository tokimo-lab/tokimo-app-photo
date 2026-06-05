#![allow(dead_code)]
//! Shared parent/child job machinery for photo background workers (sidecar port).
//!
//! Background workers that may need to process hundreds of thousands of
//! photos are split into a parent `*_scan` job (which enumerates pending
//! photo IDs and enqueues one child job per photo) and the child jobs
//! themselves.
//!
//! In the pre-split host the parent transitioned
//! `pending → running → waiting → completed` via the queue framework's
//! `_phase: "waiting"` magic key, and child jobs aggregated their results
//! back onto the parent via `JobRepo::aggregate_parent_progress`. The sidecar
//! has neither: there is no host `_phase` handling and no host-side
//! aggregation. Instead the sidecar self-drives parent/child lifecycle via the
//! bus `jobs` RPCs — children query the parent's child set with
//! `jobs::progress_summary` and update the parent directly with
//! `jobs::update_progress` / `jobs::update_status`.
//!
//! This module factors out the wiring that's common across the four
//! photo task types (OCR / CLIP / face / geocode).

use std::collections::HashMap;
use std::sync::Arc;

use serde_json::{Value as JsonValue, json};
use tracing::{info, warn};
use uuid::Uuid;

use crate::bus_clients::jobs::{
    self, CreateJobRequest, JobFilter, QueryJobsRequest, UpdateStatusRequest, photo_caller,
    photo_service_caller,
};
use crate::ctx::AppCtx;
use crate::db::repos::library_repo::PhotoLibraryRepo;
use crate::services::notifications as photo_notify;

type DynErr = Box<dyn std::error::Error + Send + Sync>;

/// Build the parent data JSON. Includes the legacy `_phase: "waiting"` key for
/// forward-compatibility. NOTE: the current host bus-proxy ignores the value
/// returned from a scan handler, so this blob is advisory only — the sidecar
/// self-aggregates parent progress via [`finalize_child`].
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
async fn library_name(ctx: &Arc<AppCtx>, app_uuid: Uuid) -> String {
    PhotoLibraryRepo::get_by_id(&ctx.db, app_uuid)
        .await
        .ok()
        .flatten()
        .map_or_else(|| app_uuid.to_string(), |m| m.name)
}

/// Run the "scan" half of a parent/child photo job: list pending photo IDs,
/// enqueue one child job per photo, and return a data blob that mirrors the
/// legacy `waiting` shape. Idempotent: on retry it detects the
/// `totalChildren` field already set by a prior partial run and skips
/// re-enqueueing children.
pub async fn run_scan<F>(
    ctx: &Arc<AppCtx>,
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
    let lib_name = library_name(ctx, app_uuid).await;

    // Idempotency: if a previous (crashed) run already enqueued children,
    // skip the enqueue phase and just return the waiting blob again.
    if let Ok(resp) = jobs::query(
        &ctx.client(),
        photo_service_caller(),
        QueryJobsRequest {
            id: Some(job_id),
            ..Default::default()
        },
    )
    .await
        && let Some(self_job) = resp.items.first()
        && let Some(data) = self_job.data.as_ref()
        && data.get("totalChildren").is_some()
    {
        info!("[{task_type}_scan] resuming parent {job_id}: children already enqueued");
        let total = data
            .get("totalChildren")
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
            photo_notify::notify_processing_completed(uid, app_uuid, &lib_name, task_type, 0);
        }
        return Ok(Some(json!({
            "processed": 0,
            "libraryName": lib_name,
        })));
    }

    // One child job per photo. parentJobId + taskType travel in the params so
    // child handlers can surface them, and are ALSO persisted into dedicated
    // `parent_job_id` / `task_type` columns (via batch_children) so DB queries
    // can rely on stable indexed columns even if handlers overwrite `data`.
    let children: Vec<CreateJobRequest> = pending
        .iter()
        .map(|photo_id| {
            let child_params = json!({
                "photoLibraryId": app_uuid.to_string(),
                "photoId": photo_id.to_string(),
                "libraryName": lib_name,
                "parentJobId": job_id.to_string(),
                "taskType": task_type,
            });
            let mut r = CreateJobRequest::new(child_job_type, child_params);
            r.parent_job_id = Some(job_id);
            r.task_type = Some(task_type.to_string());
            r
        })
        .collect();
    let inserted =
        jobs::batch_children(&ctx.client(), photo_caller(user_id), job_id, children).await?;
    info!(
        "[{task_type}_scan] enqueued {} child jobs (one per photo)",
        inserted.len()
    );

    // Fire an immediate 0/total progress notification so the user sees the
    // task in their notification center right away.
    if let Some(uid) = user_id {
        photo_notify::notify_processing_progress(uid, app_uuid, &lib_name, task_type, 0, total);
    }

    Ok(Some(parent_data_waiting(total, &lib_name, task_type)))
}

/// Parsed `(photoLibraryId, photoId, libraryName, parentJobId, taskType)` from
/// a child job's params.
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

/// After processing a child photo, aggregate the parent's progress over the
/// bus and dispatch progress / completion notifications for the user.
///
/// Replaces the host's `JobRepo::aggregate_parent_progress`: the sidecar
/// queries the OS job store for all siblings via `jobs::progress_summary` and
/// updates the parent directly.
pub async fn finalize_child(
    ctx: &Arc<AppCtx>,
    user_id: Option<Uuid>,
    child: &ChildContext,
    child_job_type: &str,
    success: u32,
    failures: u32,
) -> Result<Option<JsonValue>, DynErr> {
    let mut params_match: HashMap<String, String> = HashMap::new();
    params_match.insert("parentJobId".to_string(), child.parent_job_id.to_string());
    let filter = JobFilter {
        status: None,
        job_type: Some(child_job_type.to_string()),
        params_match: Some(params_match),
        parents_only: Some(false),
    };

    let summary = jobs::progress_summary(
        &ctx.client(),
        photo_service_caller(),
        filter,
        vec![child_job_type.to_string()],
    )
    .await?;

    // The current child is NOT yet marked completed/failed in the OS store
    // (we're still inside its handler), so inject its outcome to keep the
    // parent's progress/status accurate.
    let successes = summary.completed + i64::from(success);
    let total_failed = summary.failed + i64::from(failures);
    let done = successes + total_failed;
    let total = summary.total;
    let completed = total > 0 && done >= total;

    let pct = if total > 0 {
        ((done as f64 / total as f64) * 100.0)
            .round()
            .clamp(0.0, 100.0) as i32
    } else {
        0
    };
    let data = json!({
        "totalChildren": total,
        "done": done,
        "successes": successes,
        "failures": total_failed,
        "libraryName": child.library_name,
        "taskType": child.task_type,
    });

    // Best-effort parent update — the parent may already be `completed`
    // host-side; do NOT fail the child if these error.
    if completed {
        if let Err(e) = jobs::update_status(
            &ctx.client(),
            photo_service_caller(),
            UpdateStatusRequest {
                job_id: child.parent_job_id,
                status: "completed".into(),
                error: None,
                result: Some(data.clone()),
                progress: Some(100),
            },
        )
        .await
        {
            warn!("finalize_child: parent update_status failed: {e}");
        }
    } else if let Err(e) = jobs::update_progress(
        &ctx.client(),
        photo_service_caller(),
        child.parent_job_id,
        pct,
        Some(data.clone()),
    )
    .await
    {
        warn!("finalize_child: parent update_progress failed: {e}");
    }

    if let Some(uid) = user_id {
        if completed {
            photo_notify::notify_processing_completed(
                uid,
                child.app_id,
                &child.library_name,
                &child.task_type,
                successes,
            );
        } else {
            photo_notify::notify_processing_progress(
                uid,
                child.app_id,
                &child.library_name,
                &child.task_type,
                done,
                total,
            );
        }
    }

    Ok(Some(json!({
        "parentJobId": child.parent_job_id.to_string(),
        "taskType": child.task_type,
        "processed": success,
        "failed": failures,
    })))
}
