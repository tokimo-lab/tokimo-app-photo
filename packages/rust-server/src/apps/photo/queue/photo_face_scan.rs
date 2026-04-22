//! Parent scan job for photo face detection.
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
    job_id: Uuid,
    payload: &JsonValue,
    user_id: Option<Uuid>,
    cancel: &JobCancel,
) -> Result<Option<JsonValue>, Box<dyn std::error::Error + Send + Sync>> {
    check_cancel(cancel)?;
    let ai = state.ai.clone();
    parent_child::run_scan(
        db,
        state,
        job_id,
        payload,
        user_id,
        "photo_face_detect",
        "photo_face",
        async move |app_uuid| PhotoFaceService::list_pending_photo_ids(db, &ai, app_uuid).await,
    )
    .await
}
