//! Parent scan job for photo CLIP embedding. Enumerates photos missing a
//! vector and enqueues one `photo_clip` child job per photo.
use std::sync::Arc;

use sea_orm::DatabaseConnection;
use serde_json::Value as JsonValue;
use uuid::Uuid;

use crate::AppCtx;
use crate::queue::parent_child;
use crate::services::clip::PhotoClipService;
use crate::queue::cancellation::{JobCancel, check_cancel};

pub async fn handle(
    db: &DatabaseConnection,
    state: &Arc<AppCtx>,
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
        "photo_clip",
        "photo_clip",
        async move |app_uuid| PhotoClipService::list_pending_photo_ids(db, &state_owned, app_uuid).await,
    )
    .await
}
