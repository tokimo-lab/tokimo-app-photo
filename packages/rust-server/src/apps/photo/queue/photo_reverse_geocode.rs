use sea_orm::DatabaseConnection;
use serde_json::{json, Value as JsonValue};
use std::sync::Arc;
use tracing::info;
use uuid::Uuid;

use crate::apps::photo::services::geo::PhotoGeoService;
use crate::AppState;

/// Job handler: batch reverse-geocode all photos with GPS in an app.
///
/// Payload: `{ "appId": "uuid-string" }`
pub async fn handle(
    db: &DatabaseConnection,
    state: &Arc<AppState>,
    _job_id: Uuid,
    payload: &JsonValue,
) -> Result<Option<JsonValue>, Box<dyn std::error::Error + Send + Sync>> {
    let app_id = payload
        .get("appId")
        .and_then(|v| v.as_str())
        .ok_or("Missing appId in payload")?;
    let app_uuid = Uuid::parse_str(app_id)?;

    info!("[photo_reverse_geocode] Starting for app {app_id}");

    let count =
        PhotoGeoService::reverse_geocode_app(db, &state.http_client, app_uuid).await?;

    info!("[photo_reverse_geocode] Done: {count} photos geocoded");

    Ok(Some(json!({
        "geocoded": count,
    })))
}
