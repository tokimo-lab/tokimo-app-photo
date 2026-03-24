use sea_orm::DatabaseConnection;
use serde_json::{json, Value as JsonValue};
use std::sync::Arc;
use tracing::info;
use uuid::Uuid;

use crate::services::photo_face::PhotoFaceService;
use crate::AppState;

/// Job handler: batch face detection for all unscanned photos in an app.
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

    info!("[photo_face_detect] Starting face detection batch for app {app_id}");

    let count =
        PhotoFaceService::detect_app(db, &state.http_client, state, app_uuid).await?;

    info!("[photo_face_detect] Done: {count} photos processed");

    Ok(Some(json!({
        "processed": count,
    })))
}
