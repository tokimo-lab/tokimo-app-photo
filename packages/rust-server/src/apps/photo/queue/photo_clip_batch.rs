//! Child batch job for photo CLIP embedding.
use std::sync::Arc;

use sea_orm::DatabaseConnection;
use serde_json::Value as JsonValue;
use uuid::Uuid;

use crate::AppState;
use crate::apps::photo::queue::parent_child;
use crate::apps::photo::services::clip::PhotoClipService;
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
    let (success, failures) =
        PhotoClipService::process_photo_ids(db, state, ctx.app_id, ctx.photo_ids.clone()).await;
    parent_child::finalize_child(db, state, user_id, &ctx, success, failures).await
}
