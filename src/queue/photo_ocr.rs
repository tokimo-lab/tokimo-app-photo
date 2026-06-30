//! Child job for photo OCR. Processes a single photo and reports
//! aggregated progress / completion back to the parent job's notification.
use std::sync::Arc;

use sea_orm::DatabaseConnection;
use serde_json::Value as JsonValue;
use uuid::Uuid;

use crate::AppState;
use crate::queue::cancellation::{JobCancel, check_cancel};
use crate::queue::parent_child;
use crate::services::media_jobs::{self, MediaJobOutcome};

pub async fn handle(
    db: &DatabaseConnection,
    state: &Arc<AppState>,
    job_id: Uuid,
    params: &JsonValue,
    user_id: Option<Uuid>,
    cancel: &JobCancel,
) -> Result<Option<JsonValue>, Box<dyn std::error::Error + Send + Sync>> {
    check_cancel(cancel)?;
    let ctx = parent_child::parse_child_params(params)?;
    check_cancel(cancel)?;
    let uid = user_id.ok_or("photo_ocr requires user id")?;
    match media_jobs::ocr_photo_job(state, job_id, ctx.photo_id, uid).await {
        Ok(MediaJobOutcome::Waiting(data)) => Ok(Some(data)),
        Ok(MediaJobOutcome::Completed(data)) => {
            let count = data.get("ocrCount").and_then(|value| value.as_u64()).unwrap_or(0);
            parent_child::finalize_child(db, state, user_id, &ctx, 1, 0).await?;
            Ok(Some(serde_json::json!({
                "parentJobId": ctx.parent_job_id.to_string(),
                "taskType": ctx.task_type,
                "processed": 1,
                "ocrCount": count,
            })))
        }
        Err(error) => {
            parent_child::finalize_child(db, state, user_id, &ctx, 0, 1).await?;
            Err(error.into())
        }
    }
}
