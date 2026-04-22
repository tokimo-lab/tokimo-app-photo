//! Parent scan job for photo CLIP embedding. Enumerates photos missing a
//! vector and enqueues `photo_clip_batch` child jobs of size 10.
use std::sync::Arc;

use sea_orm::DatabaseConnection;
use serde_json::Value as JsonValue;
use uuid::Uuid;

use crate::AppState;
use crate::apps::photo::queue::parent_child;
use crate::apps::photo::services::clip::PhotoClipService;
use crate::queue::cancellation::{JobCancel, check_cancel};

const BATCH_SIZE: usize = 10;

pub async fn handle(
    db: &DatabaseConnection,
    state: &Arc<AppState>,
    job_id: Uuid,
    payload: &JsonValue,
    user_id: Option<Uuid>,
    cancel: &JobCancel,
) -> Result<Option<JsonValue>, Box<dyn std::error::Error + Send + Sync>> {
    check_cancel(cancel)?;
    let state_owned = state.clone();
    parent_child::run_scan(
        db,
        state,
        job_id,
        payload,
        user_id,
        "photo_clip",
        "photo_clip_batch",
        BATCH_SIZE,
        async move |app_uuid| PhotoClipService::list_pending_photo_ids(db, &state_owned, app_uuid).await,
    )
    .await
}
