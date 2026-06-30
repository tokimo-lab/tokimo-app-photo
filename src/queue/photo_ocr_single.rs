//! Single-photo OCR job (user-triggered "refresh" action).
//!
//! Distinct from `photo_ocr` (the scan-child variant): this type has no
//! parent and is enqueued directly with `dedupe_key=photo_id` and
//! `priority=UserAction`, so it can preempt or rejoin any in-flight scan
//! work for the same photo.
use std::sync::Arc;

use sea_orm::DatabaseConnection;
use serde_json::{Value as JsonValue, json};
use uuid::Uuid;

use crate::AppState;
use crate::queue::cancellation::{JobCancel, check_cancel};
use crate::services::media_jobs::{self, MediaJobOutcome};

pub async fn handle(
    _db: &DatabaseConnection,
    state: &Arc<AppState>,
    job_id: Uuid,
    params: &JsonValue,
    user_id: Option<Uuid>,
    cancel: &JobCancel,
) -> Result<Option<JsonValue>, Box<dyn std::error::Error + Send + Sync>> {
    check_cancel(cancel)?;
    let photo_id = params
        .get("photoId")
        .and_then(|v| v.as_str())
        .ok_or("Missing photoId in params")?;
    let photo_uuid = Uuid::parse_str(photo_id)?;
    check_cancel(cancel)?;
    let uid = user_id.ok_or("photo_ocr_single requires user id")?;
    match media_jobs::ocr_photo_job(state, job_id, photo_uuid, uid).await? {
        MediaJobOutcome::Waiting(data) => Ok(Some(data)),
        MediaJobOutcome::Completed(data) => {
            let count = data.get("ocrCount").and_then(|value| value.as_u64()).unwrap_or(0);
            Ok(Some(json!({ "ocrCount": count })))
        }
    }
}
