#![allow(dead_code)]
//! Parent scan job for photo reverse geocoding.
use std::sync::Arc;

use serde_json::Value as JsonValue;
use uuid::Uuid;

use crate::ctx::AppCtx;
use crate::queue::cancellation::{JobCancel, check_cancel};
use crate::queue::parent_child;
use crate::services::geo::PhotoGeoService;

pub async fn handle(
    ctx: &Arc<AppCtx>,
    job_id: Uuid,
    params: &JsonValue,
    user_id: Option<Uuid>,
    cancel: &JobCancel,
) -> Result<Option<JsonValue>, Box<dyn std::error::Error + Send + Sync>> {
    check_cancel(cancel)?;
    let db = ctx.db.clone();
    parent_child::run_scan(
        ctx,
        job_id,
        params,
        user_id,
        "photo_reverse_geocode",
        "photo_geocode",
        async move |app_uuid| PhotoGeoService::list_pending_photo_ids(&db, app_uuid).await,
    )
    .await
}
