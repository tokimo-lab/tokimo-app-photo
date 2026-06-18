//! Person sync job — notifies person app about media changes (delete/update).
//!
//! If person app is unavailable, the job schedules itself for retry after 10 minutes.
use std::sync::Arc;

use sea_orm::DatabaseConnection;
use serde_json::{Value as JsonValue, json};
use uuid::Uuid;

use crate::AppState;
use crate::bus_clients::person;
use crate::queue::cancellation::{JobCancel, check_cancel};

/// Retry delay when person app is unavailable (10 minutes).
const RETRY_DELAY_SECS: i64 = 600;

/// Job handler: delete source data from person app.
///
/// If person app is unavailable, schedules retry after 10 minutes.
pub async fn handle_delete_source(
    db: &DatabaseConnection,
    state: &Arc<AppState>,
    job_id: Uuid,
    params: &JsonValue,
    user_id: Option<Uuid>,
    cancel: &JobCancel,
) -> Result<Option<JsonValue>, Box<dyn std::error::Error + Send + Sync>> {
    check_cancel(cancel)?;

    let source_app = params
        .get("sourceApp")
        .and_then(|v| v.as_str())
        .ok_or("Missing sourceApp in params")?;
    let source_id = params
        .get("sourceId")
        .and_then(|v| v.as_str())
        .ok_or("Missing sourceId in params")?;

    let bus = state
        .bus_client
        .get()
        .ok_or("Bus client not initialized")?;
    let caller = person::photo_caller(user_id);

    match person::delete_source(bus, caller, source_app, source_id).await {
        Ok(_) => {
            tracing::info!(
                "person_sync: deleted source {source_app}/{source_id} successfully"
            );
            Ok(Some(json!({ "synced": true })))
        }
        Err(e) => {
            tracing::warn!(
                "person_sync: person app unavailable for {source_app}/{source_id}, \
                 scheduling retry in {RETRY_DELAY_SECS}s: {e}"
            );

            // Schedule retry: set job to scheduled status with wake_at
            let wake_at = chrono::Utc::now() + chrono::Duration::seconds(RETRY_DELAY_SECS);
            let wake_at_fixed = wake_at.fixed_offset();

            match crate::db::repos::job_repo::JobRepo::schedule_job(db, job_id, wake_at_fixed)
                .await
            {
                Ok(Some(_)) => {
                    tracing::info!(
                        "person_sync: job {job_id} scheduled for retry at {wake_at_fixed}"
                    );
                    // Return error to signal the job worker that this job didn't complete
                    // (it's now scheduled, not failed)
                    Err(format!(
                        "Person app unavailable, scheduled retry at {wake_at_fixed}"
                    )
                    .into())
                }
                Ok(None) => {
                    tracing::warn!(
                        "person_sync: job {job_id} not found or already terminal"
                    );
                    Err("Job not found or already terminal".into())
                }
                Err(e) => {
                    tracing::error!("person_sync: failed to schedule job {job_id}: {e}");
                    Err(format!("Failed to schedule retry: {e}").into())
                }
            }
        }
    }
}

/// Job handler: register faces in person app.
///
/// If person app is unavailable, schedules retry after 10 minutes.
pub async fn handle_register_faces(
    db: &DatabaseConnection,
    state: &Arc<AppState>,
    job_id: Uuid,
    params: &JsonValue,
    user_id: Option<Uuid>,
    cancel: &JobCancel,
) -> Result<Option<JsonValue>, Box<dyn std::error::Error + Send + Sync>> {
    check_cancel(cancel)?;

    let image_hash = params
        .get("imageHash")
        .and_then(|v| v.as_str())
        .ok_or("Missing imageHash in params")?;
    let source_app = params
        .get("sourceApp")
        .and_then(|v| v.as_str())
        .ok_or("Missing sourceApp in params")?;
    let source_id = params
        .get("sourceId")
        .and_then(|v| v.as_str())
        .ok_or("Missing sourceId in params")?;
    let faces = params
        .get("faces")
        .and_then(|v| v.as_array())
        .ok_or("Missing faces array in params")?
        .clone();

    let bus = state
        .bus_client
        .get()
        .ok_or("Bus client not initialized")?;
    let caller = person::photo_caller(user_id);

    match person::register_faces(bus, caller, image_hash, source_app, source_id, faces).await {
        Ok(_) => {
            tracing::info!(
                "person_sync: registered faces for {source_app}/{source_id} successfully"
            );
            Ok(Some(json!({ "synced": true })))
        }
        Err(e) => {
            tracing::warn!(
                "person_sync: person app unavailable for {source_app}/{source_id}, \
                 scheduling retry in {RETRY_DELAY_SECS}s: {e}"
            );

            // Schedule retry
            let wake_at = chrono::Utc::now() + chrono::Duration::seconds(RETRY_DELAY_SECS);
            let wake_at_fixed = wake_at.fixed_offset();

            match crate::db::repos::job_repo::JobRepo::schedule_job(db, job_id, wake_at_fixed)
                .await
            {
                Ok(Some(_)) => {
                    tracing::info!(
                        "person_sync: job {job_id} scheduled for retry at {wake_at_fixed}"
                    );
                    Err(format!(
                        "Person app unavailable, scheduled retry at {wake_at_fixed}"
                    )
                    .into())
                }
                Ok(None) => {
                    tracing::warn!(
                        "person_sync: job {job_id} not found or already terminal"
                    );
                    Err("Job not found or already terminal".into())
                }
                Err(e) => {
                    tracing::error!("person_sync: failed to schedule job {job_id}: {e}");
                    Err(format!("Failed to schedule retry: {e}").into())
                }
            }
        }
    }
}
