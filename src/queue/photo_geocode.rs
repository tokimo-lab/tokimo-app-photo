#![allow(dead_code)]
//! Child job for photo reverse geocoding (one photo per job).
use std::sync::Arc;

use serde_json::Value as JsonValue;
use uuid::Uuid;

use crate::ctx::AppCtx;
use crate::queue::cancellation::{JobCancel, check_cancel};
use crate::queue::parent_child;
use crate::services::geo::PhotoGeoService;

pub async fn handle(
    ctx: &Arc<AppCtx>,
    _job_id: Uuid,
    params: &JsonValue,
    user_id: Option<Uuid>,
    cancel: &JobCancel,
) -> Result<Option<JsonValue>, Box<dyn std::error::Error + Send + Sync>> {
    check_cancel(cancel)?;
    let child_ctx = parent_child::parse_child_params(params)?;
    check_cancel(cancel)?;
    let http = reqwest::Client::new();
    let (success, failures, errors) =
        PhotoGeoService::process_photo_ids(&ctx.db, &http, vec![child_ctx.photo_id]).await;
    let out = parent_child::finalize_child(ctx, user_id, &child_ctx, "photo_geocode", success, failures).await?;
    if failures > 0 {
        let msg = errors
            .into_iter()
            .next()
            .unwrap_or_else(|| "photo_geocode failed".to_string());
        return Err(msg.into());
    }
    Ok(out)
}
