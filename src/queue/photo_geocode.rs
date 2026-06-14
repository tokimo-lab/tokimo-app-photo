//! Child job for photo reverse geocoding (one photo per job).
use std::sync::Arc;

use sea_orm::DatabaseConnection;
use serde_json::Value as JsonValue;
use uuid::Uuid;

use crate::AppState;
use crate::queue::parent_child;
use crate::services::geo::PhotoGeoService;
use crate::queue::cancellation::{JobCancel, check_cancel};

pub async fn handle(
    db: &DatabaseConnection,
    state: &Arc<AppState>,
    _job_id: Uuid,
    params: &JsonValue,
    user_id: Option<Uuid>,
    cancel: &JobCancel,
) -> Result<Option<JsonValue>, Box<dyn std::error::Error + Send + Sync>> {
    check_cancel(cancel)?;
    let ctx = parent_child::parse_child_params(params)?;
    check_cancel(cancel)?;
    let (success, failures, errors) =
        PhotoGeoService::process_photo_ids(db, &state.http_client, vec![ctx.photo_id]).await;
    let out = parent_child::finalize_child(db, state, user_id, &ctx, success, failures).await?;
    if failures > 0 {
        let msg = errors
            .into_iter()
            .next()
            .unwrap_or_else(|| "photo_geocode failed".to_string());
        return Err(msg.into());
    }
    Ok(out)
}
