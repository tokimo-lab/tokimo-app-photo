//! Parent scan job for photo reverse geocoding.
use std::sync::Arc;

use sea_orm::DatabaseConnection;
use serde_json::Value as JsonValue;
use uuid::Uuid;

use crate::AppState;
use crate::apps::photo::queue::parent_child;
use crate::apps::photo::services::geo::PhotoGeoService;
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
    parent_child::run_scan(
        db,
        state,
        job_id,
        payload,
        user_id,
        "photo_reverse_geocode",
        "photo_geocode",
        async |app_uuid| PhotoGeoService::list_pending_photo_ids(db, app_uuid).await,
    )
    .await
}
