#![allow(dead_code)]
//! Scan preemption helper: cancel any active parent scan of the same
//! `(app_id, task_type)` so that the newly-enqueued scan becomes the sole
//! authority for that library+kind.
//!
//! Rewritten for the sidecar: the presplit version flipped local `jobs`
//! rows and broadcast in-process `AppEvent::JobUpdate`. Here the job queue
//! lives behind the bus, so both helpers delegate to the `jobs.preempt`
//! RPC (which performs the parent flip + child cascade + event broadcast
//! host-side) and return the count of affected jobs.
//!
//! Callers must invoke this **before** enqueuing the replacement scan so
//! children from the old parent don't intermix with the new one.

use std::collections::HashMap;
use std::sync::Arc;

use uuid::Uuid;

use crate::bus_clients::jobs::{self, JobFilter, photo_caller};
use crate::ctx::AppCtx;
use crate::error::AppError;
use crate::queue::cancellation::PREEMPT_REASON;

/// Preempt any in-flight **parent** scan job for `(app_id, task_type)`.
///
/// `task_type` is the scan job type passed directly by callers (e.g.
/// `"photo_ocr_scan"`), so it maps 1:1 onto the bus `job_type` filter — we
/// do NOT append `_scan` here.
pub async fn preempt_scan_for(
    ctx: &Arc<AppCtx>,
    app_id: Uuid,
    task_type: &str,
    user_id: Uuid,
) -> Result<usize, AppError> {
    let mut params_match = HashMap::new();
    params_match.insert("photoLibraryId".to_string(), app_id.to_string());
    let filter = JobFilter {
        status: None,
        job_type: Some(task_type.to_string()),
        params_match: Some(params_match),
        parents_only: Some(true),
    };
    let ids = jobs::preempt(
        &ctx.client(),
        photo_caller(Some(user_id)),
        filter,
        PREEMPT_REASON,
    )
    .await?;
    Ok(ids.len())
}

/// Preempt any in-flight scan-**child** for `photo_id` with `task_type` (e.g.
/// `"photo_ocr"`). Used when the user fires a single-photo refresh action so
/// the user-priority single job becomes the sole authority for that photo.
///
/// Scan children are enqueued with `job_type == task_type` and a `photoId`
/// param (see presplit `queue::parent_child::run_scan`), so we filter on
/// `photoId` + the child `job_type` and disable `parents_only`.
pub async fn preempt_scan_child_for_photo(
    ctx: &Arc<AppCtx>,
    task_type: &str,
    photo_id: Uuid,
    user_id: Uuid,
) -> Result<usize, AppError> {
    let mut params_match = HashMap::new();
    params_match.insert("photoId".to_string(), photo_id.to_string());
    let filter = JobFilter {
        status: None,
        job_type: Some(task_type.to_string()),
        params_match: Some(params_match),
        parents_only: Some(false),
    };
    let ids = jobs::preempt(
        &ctx.client(),
        photo_caller(Some(user_id)),
        filter,
        PREEMPT_REASON,
    )
    .await?;
    Ok(ids.len())
}
