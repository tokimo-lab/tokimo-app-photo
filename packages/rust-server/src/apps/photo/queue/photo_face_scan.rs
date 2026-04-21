//! Parent scan job for photo face detection.
use std::sync::Arc;

use sea_orm::DatabaseConnection;
use serde_json::Value as JsonValue;
use uuid::Uuid;

use crate::AppState;
use crate::apps::photo::queue::parent_child;
use crate::apps::photo::services::face::PhotoFaceService;

const BATCH_SIZE: usize = 10;

pub async fn handle(
    db: &DatabaseConnection,
    state: &Arc<AppState>,
    job_id: Uuid,
    payload: &JsonValue,
    user_id: Option<Uuid>,
) -> Result<Option<JsonValue>, Box<dyn std::error::Error + Send + Sync>> {
    let ai = state.ai.clone();
    parent_child::run_scan(
        db,
        state,
        job_id,
        payload,
        user_id,
        "photo_face_detect",
        "photo_face_batch",
        BATCH_SIZE,
        async move |app_uuid| PhotoFaceService::list_pending_photo_ids(db, &ai, app_uuid).await,
    )
    .await
}
