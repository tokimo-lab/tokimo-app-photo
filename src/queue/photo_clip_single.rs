//! Single-photo CLIP embedding job (user-triggered "refresh" action).
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
    let uid = user_id.ok_or("photo_clip_single requires user id")?;
    match media_jobs::embed_photo_job(state, job_id, photo_uuid, uid).await? {
        MediaJobOutcome::Waiting(data) => Ok(Some(data)),
        MediaJobOutcome::Completed(_) => Ok(Some(json!({ "status": "ok" }))),
    }
}
