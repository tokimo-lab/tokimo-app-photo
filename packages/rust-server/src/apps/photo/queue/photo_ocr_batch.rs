//! Child batch job for photo OCR. Processes a slice of photo IDs and reports
//! aggregated progress / completion back to the parent job's notification.
use std::sync::Arc;

use sea_orm::DatabaseConnection;
use serde_json::Value as JsonValue;
use uuid::Uuid;

use crate::AppState;
use crate::apps::photo::queue::parent_child;
use crate::apps::photo::services::ocr::PhotoOcrService;

pub async fn handle(
    db: &DatabaseConnection,
    state: &Arc<AppState>,
    _job_id: Uuid,
    payload: &JsonValue,
    user_id: Option<Uuid>,
) -> Result<Option<JsonValue>, Box<dyn std::error::Error + Send + Sync>> {
    let ctx = parent_child::parse_child_payload(payload)?;
    let (success, failures) = PhotoOcrService::process_photo_ids(db, state, ctx.photo_ids.clone()).await;
    parent_child::finalize_child(db, state, user_id, &ctx, success, failures).await
}
