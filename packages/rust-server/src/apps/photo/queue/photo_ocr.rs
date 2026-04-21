use sea_orm::DatabaseConnection;
use serde_json::{Value as JsonValue, json};
use std::sync::Arc;
use tracing::info;
use uuid::Uuid;

use crate::AppState;
use crate::apps::photo::repos::PhotoLibraryRepo;
use crate::apps::photo::services::notifications as photo_notify;
use crate::apps::photo::services::ocr::PhotoOcrService;

/// Job handler: batch OCR all unscanned photos in an app.
///
/// Payload: `{ "appId": "uuid-string" }`
pub async fn handle(
    db: &DatabaseConnection,
    state: &Arc<AppState>,
    _job_id: Uuid,
    payload: &JsonValue,
    user_id: Option<Uuid>,
) -> Result<Option<JsonValue>, Box<dyn std::error::Error + Send + Sync>> {
    let app_id = payload
        .get("appId")
        .and_then(|v| v.as_str())
        .ok_or("Missing appId in payload")?;
    let app_uuid = Uuid::parse_str(app_id)?;

    info!("[photo_ocr] Starting OCR batch for app {app_id}");

    let library_name = PhotoLibraryRepo::get_by_id(db, app_uuid)
        .await
        .ok()
        .flatten()
        .map_or_else(|| app_id.to_string(), |m| m.name);

    match PhotoOcrService::ocr_app(db, state, app_uuid).await {
        Ok(count) => {
            info!("[photo_ocr] Done: {count} photos processed");
            if let Some(uid) = user_id {
                photo_notify::notify_processing_completed(
                    state,
                    uid,
                    app_uuid,
                    &library_name,
                    "photo_ocr",
                    i64::from(count),
                )
                .await;
            }
            Ok(Some(json!({ "processed": count })))
        }
        Err(e) => {
            if let Some(uid) = user_id {
                photo_notify::notify_processing_failed(
                    state,
                    uid,
                    app_uuid,
                    &library_name,
                    "photo_ocr",
                    &e.to_string(),
                )
                .await;
            }
            Err(e.into())
        }
    }
}
