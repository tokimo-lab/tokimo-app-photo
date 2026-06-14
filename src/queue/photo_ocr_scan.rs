//! Parent scan job for photo OCR. Enumerates pending photo IDs and enqueues
//! one `photo_ocr` child job per photo. Returns `_phase: "waiting"` so
//! the queue framework parks the parent until children finish.
use std::sync::Arc;

use sea_orm::DatabaseConnection;
use serde_json::Value as JsonValue;
use uuid::Uuid;

use crate::AppState;
use crate::queue::parent_child;
use crate::services::ocr::PhotoOcrService;
use crate::queue::cancellation::{JobCancel, check_cancel};

pub async fn handle(
    db: &DatabaseConnection,
    state: &Arc<AppState>,
    job_id: Uuid,
    params: &JsonValue,
    user_id: Option<Uuid>,
    cancel: &JobCancel,
) -> Result<Option<JsonValue>, Box<dyn std::error::Error + Send + Sync>> {
    check_cancel(cancel)?;
    let state_owned = state.clone();
    parent_child::run_scan(
        db,
        state,
        job_id,
        params,
        user_id,
        "photo_ocr",
        "photo_ocr",
        async move |app_uuid| PhotoOcrService::list_pending_photo_ids(db, &state_owned, app_uuid).await,
    )
    .await
}
