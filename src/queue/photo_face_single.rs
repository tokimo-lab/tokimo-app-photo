//! Single-photo face-detection job (user-triggered "refresh" action).
use std::sync::Arc;

use sea_orm::DatabaseConnection;
use serde_json::{Value as JsonValue, json};
use uuid::Uuid;

use crate::AppState;
use crate::apps::photo::services::face::PhotoFaceService;
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
    let count = PhotoFaceService::detect_faces(db, &state.ai, &state.sources, photo_uuid).await?;
    Ok(Some(json!({ "faceCount": count })))
}
