//! Scan preemption helper: cancel any active parent scan of the same
//! `(app_id, task_type)` so that the newly-enqueued scan becomes the sole
//! authority for that library+kind. See plan Round A.
//!
//! The helper:
//!   1. Flips pending/running/waiting/suspended parent jobs to `cancelled`
//!      with `jobs.error = "被新的扫描覆盖"` (via [`JobRepo::preempt_scans`]).
//!   2. Cascades the same reason to every still-active child of those
//!      parents (via [`JobRepo::cancel_children_of`]).
//!   3. Signals every affected job's cooperative cancel handle with
//!      `CancelReason::Preempted` so any running worker bails out.
//!   4. Broadcasts a fresh [`AppEvent::JobUpdate`] for each flipped job so
//!      the task-queue UI refreshes without a manual re-fetch.
//!
//! Callers must invoke this **before** enqueuing the replacement scan so
//! children from the old parent don't intermix with the new one.

use std::sync::Arc;
use uuid::Uuid;

use crate::AppState;
use crate::db::entities::jobs;
use crate::db::models::job::JobOutput;
use crate::db::repos::job_repo::JobRepo;
use crate::error::AppError;
use crate::queue::{AppEvent, CancelReason, PREEMPT_REASON};
use sea_orm::EntityTrait;

pub async fn preempt_scan_for(
    state: &Arc<AppState>,
    app_id: Uuid,
    task_type: &str,
) -> Result<usize, AppError> {
    let parents = JobRepo::preempt_scans(&state.db, app_id, task_type, PREEMPT_REASON).await?;
    if parents.is_empty() {
        return Ok(0);
    }
    let children = JobRepo::cancel_children_of(&state.db, &parents, PREEMPT_REASON).await?;

    // Signal cooperative cancel for anything still live in-process.
    for id in parents.iter().chain(children.iter()) {
        state.job_cancel.cancel_one(*id, CancelReason::Preempted);
    }

    // Broadcast fresh JobUpdate events so the task-queue UI reflects the
    // cancelled rows without waiting for the next poll.
    let all_ids: Vec<Uuid> = parents.iter().chain(children.iter()).copied().collect();
    for id in &all_ids {
        if let Ok(Some(model)) = jobs::Entity::find_by_id(*id).one(&state.db).await {
            let _ = state.event_tx.send(AppEvent::JobUpdate {
                job: Box::new(JobOutput::from(model)),
            });
        }
    }

    Ok(all_ids.len())
}

/// Preempt any in-flight scan-child for `photo_id` with `task_type` (e.g.
/// `photo_ocr`). Used when the user fires a single-photo refresh action so
/// the user-priority single job becomes the sole authority for that photo.
pub async fn preempt_scan_child_for_photo(
    state: &Arc<AppState>,
    task_type: &str,
    photo_id: Uuid,
) -> Result<usize, AppError> {
    let cancelled =
        JobRepo::preempt_scan_child_for(&state.db, task_type, photo_id, PREEMPT_REASON).await?;
    if cancelled.is_empty() {
        return Ok(0);
    }
    for id in &cancelled {
        state.job_cancel.cancel_one(*id, CancelReason::Preempted);
    }
    for id in &cancelled {
        if let Ok(Some(model)) = jobs::Entity::find_by_id(*id).one(&state.db).await {
            let _ = state.event_tx.send(AppEvent::JobUpdate {
                job: Box::new(JobOutput::from(model)),
            });
        }
    }
    Ok(cancelled.len())
}
