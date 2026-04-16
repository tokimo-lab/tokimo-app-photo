use sea_orm::DatabaseConnection;
use serde_json::{Value as JsonValue, json};
use std::sync::Arc;
use tracing::info;
use uuid::Uuid;

use crate::AppState;
use crate::apps::photo::services::ocr::PhotoOcrService;

/// Job handler: batch OCR all unscanned photos in an app.
///
/// Payload: `{ "appId": "uuid-string" }`
pub async fn handle(
    db: &DatabaseConnection,
    state: &Arc<AppState>,
    _job_id: Uuid,
    payload: &JsonValue,
) -> Result<Option<JsonValue>, Box<dyn std::error::Error + Send + Sync>> {
    let app_id = payload
        .get("appId")
        .and_then(|v| v.as_str())
        .ok_or("Missing appId in payload")?;
    let app_uuid = Uuid::parse_str(app_id)?;

    info!("[photo_ocr] Starting OCR batch for app {app_id}");

    let count = PhotoOcrService::ocr_app(db, state, app_uuid).await?;

    info!("[photo_ocr] Done: {count} photos processed");

    Ok(Some(json!({
        "processed": count,
    })))
}
