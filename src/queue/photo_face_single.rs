//! Single-photo face-detection job (user-triggered "refresh" action).
use std::sync::Arc;

use sea_orm::DatabaseConnection;
use serde_json::{Value as JsonValue, json};
use uuid::Uuid;

use crate::AppState;
use crate::queue::cancellation::{JobCancel, check_cancel};
use crate::services::face::PhotoFaceService;

pub async fn handle(
    db: &DatabaseConnection,
    state: &Arc<AppState>,
    _job_id: Uuid,
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
    let bus = state.bus_client.get();
    let count = PhotoFaceService::detect_faces(db, photo_uuid, bus, user_id).await?;
    Ok(Some(json!({ "faceCount": count })))
}
