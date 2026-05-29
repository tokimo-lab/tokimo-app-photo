#![allow(dead_code)]
//! Parent scan job for photo face detection.
use std::sync::Arc;

use serde_json::Value as JsonValue;
use uuid::Uuid;

use crate::ctx::AppCtx;
use crate::queue::cancellation::{JobCancel, check_cancel};
use crate::queue::parent_child;
use crate::services::face::PhotoFaceService;

pub async fn handle(
    ctx: &Arc<AppCtx>,
    job_id: Uuid,
    params: &JsonValue,
    user_id: Option<Uuid>,
    cancel: &JobCancel,
) -> Result<Option<JsonValue>, Box<dyn std::error::Error + Send + Sync>> {
    check_cancel(cancel)?;
    let db = ctx.db.clone();
    let ai = ctx.ai.clone();
    parent_child::run_scan(
        ctx,
        job_id,
        params,
        user_id,
        "photo_face_detect",
        "photo_face",
        async move |app_uuid| PhotoFaceService::list_pending_photo_ids(&db, &ai, app_uuid).await,
    )
    .await
}
