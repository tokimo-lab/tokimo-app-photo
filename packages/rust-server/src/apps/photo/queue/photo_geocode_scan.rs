//! Parent scan job for photo reverse geocoding.
use std::sync::Arc;

use sea_orm::DatabaseConnection;
use serde_json::Value as JsonValue;
use uuid::Uuid;

use crate::AppState;
use crate::apps::photo::queue::parent_child;
use crate::apps::photo::services::geo::PhotoGeoService;

const BATCH_SIZE: usize = 50;

pub async fn handle(
    db: &DatabaseConnection,
    state: &Arc<AppState>,
    job_id: Uuid,
    payload: &JsonValue,
    user_id: Option<Uuid>,
) -> Result<Option<JsonValue>, Box<dyn std::error::Error + Send + Sync>> {
    parent_child::run_scan(
        db,
        state,
        job_id,
        payload,
        user_id,
        "photo_reverse_geocode",
        "photo_geocode_batch",
        BATCH_SIZE,
        async |app_uuid| PhotoGeoService::list_pending_photo_ids(db, app_uuid).await,
    )
    .await
}
