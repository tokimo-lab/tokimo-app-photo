//! Child job for photo OCR. Processes a single photo and reports
//! aggregated progress / completion back to the parent job's notification.
use std::sync::Arc;

use sea_orm::DatabaseConnection;
use serde_json::Value as JsonValue;
use uuid::Uuid;

use crate::AppCtx;
use crate::queue::parent_child;
use crate::services::ocr::PhotoOcrService;
use crate::queue::cancellation::{JobCancel, check_cancel};

pub async fn handle(
    db: &DatabaseConnection,
    state: &Arc<AppCtx>,
    _job_id: Uuid,
    params: &JsonValue,
    user_id: Option<Uuid>,
    cancel: &JobCancel,
) -> Result<Option<JsonValue>, Box<dyn std::error::Error + Send + Sync>> {
    check_cancel(cancel)?;
    let ctx = parent_child::parse_child_params(params)?;
    check_cancel(cancel)?;
    let (success, failures, errors) = PhotoOcrService::process_photo_ids(db, state, vec![ctx.photo_id]).await;
    let out = parent_child::finalize_child(db, state, user_id, &ctx, success, failures).await?;
    if failures > 0 {
        let msg = errors
            .into_iter()
            .next()
            .unwrap_or_else(|| "photo_ocr failed".to_string());
        return Err(msg.into());
    }
    Ok(out)
}
