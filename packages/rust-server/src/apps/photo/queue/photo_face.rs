//! Child job for photo face detection (one photo per job).
use std::sync::Arc;

use sea_orm::DatabaseConnection;
use serde_json::Value as JsonValue;
use uuid::Uuid;

use crate::AppState;
use crate::apps::photo::queue::parent_child;
use crate::apps::photo::services::face::PhotoFaceService;
use crate::queue::cancellation::{JobCancel, check_cancel};

pub async fn handle(
    db: &DatabaseConnection,
    state: &Arc<AppState>,
    _job_id: Uuid,
    payload: &JsonValue,
    user_id: Option<Uuid>,
    cancel: &JobCancel,
) -> Result<Option<JsonValue>, Box<dyn std::error::Error + Send + Sync>> {
    check_cancel(cancel)?;
    let ctx = parent_child::parse_child_payload(payload)?;
    check_cancel(cancel)?;
    let (success, failures, errors) =
        PhotoFaceService::process_photo_ids(db, &state.ai, &state.sources, vec![ctx.photo_id]).await;
    let out = parent_child::finalize_child(db, state, user_id, &ctx, success, failures).await?;
    if failures > 0 {
        let msg = errors.into_iter().next().unwrap_or_else(|| "photo_face failed".to_string());
        return Err(msg.into());
    }
    Ok(out)
}
