//! Parent scan job for photo OCR. Enumerates pending photo IDs and enqueues
//! `photo_ocr_batch` child jobs of size 10. Returns `_phase: "waiting"` so
//! the queue framework parks the parent until children finish.
use std::sync::Arc;

use sea_orm::DatabaseConnection;
use serde_json::Value as JsonValue;
use uuid::Uuid;

use crate::AppState;
use crate::apps::photo::queue::parent_child;
use crate::apps::photo::services::ocr::PhotoOcrService;

const BATCH_SIZE: usize = 10;

pub async fn handle(
    db: &DatabaseConnection,
    state: &Arc<AppState>,
    job_id: Uuid,
    payload: &JsonValue,
    user_id: Option<Uuid>,
) -> Result<Option<JsonValue>, Box<dyn std::error::Error + Send + Sync>> {
    let state = state.clone();
    parent_child::run_scan(
        db,
        job_id,
        payload,
        user_id,
        "photo_ocr",
        "photo_ocr_batch",
        BATCH_SIZE,
        async move |app_uuid| PhotoOcrService::list_pending_photo_ids(db, &state, app_uuid).await,
    )
    .await
}
