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
use crate::services::ocr::PhotoOcrService;
use crate::queue::cancellation::{JobCancel, check_cancel};

pub async fn handle(
    db: &DatabaseConnection,
    state: &Arc<AppState>,
    _job_id: Uuid,
    params: &JsonValue,
    _user_id: Option<Uuid>,
    cancel: &JobCancel,
) -> Result<Option<JsonValue>, Box<dyn std::error::Error + Send + Sync>> {
    check_cancel(cancel)?;
    let photo_id = params
        .get("photoId")
        .and_then(|v| v.as_str())
        .ok_or("Missing photoId in params")?;
    let photo_uuid = Uuid::parse_str(photo_id)?;
    check_cancel(cancel)?;
    let count = PhotoOcrService::ocr_photo(db, state, photo_uuid).await?;
    Ok(Some(json!({ "ocrCount": count })))
}
