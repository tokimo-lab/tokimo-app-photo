//! Parent scan job for photo face detection.
use std::sync::Arc;

use sea_orm::DatabaseConnection;
use serde_json::Value as JsonValue;
use uuid::Uuid;

use crate::AppState;
use crate::queue::cancellation::{JobCancel, check_cancel};
use crate::queue::parent_child;
use crate::services::face::PhotoFaceService;

pub async fn handle(
    db: &DatabaseConnection,
    state: &Arc<AppState>,
    job_id: Uuid,
    params: &JsonValue,
    user_id: Option<Uuid>,
    cancel: &JobCancel,
) -> Result<Option<JsonValue>, Box<dyn std::error::Error + Send + Sync>> {
    check_cancel(cancel)?;
    parent_child::run_scan(
        db,
        state,
        job_id,
        params,
        user_id,
        "photo_face_detect",
        "photo_face",
        async move |app_uuid| PhotoFaceService::list_pending_photo_ids(db, state, app_uuid).await,
    )
    .await
}
