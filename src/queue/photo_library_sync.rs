use std::sync::Arc;

use sea_orm::DatabaseConnection;
use serde_json::{Value as JsonValue, json};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::AppState;
use crate::error::AppError;
use crate::repos::PhotoLibraryRepo;
use crate::services::app_sync::{AppSyncService, SyncJobContext};
use crate::services::notifications as photo_notify;

fn string_param(params: &JsonValue, key: &str) -> Option<String> {
    params.get(key).and_then(JsonValue::as_str).map(str::to_string)
}

fn bool_param(params: &JsonValue, key: &str) -> bool {
    params.get(key).and_then(JsonValue::as_bool).unwrap_or(false)
}

pub async fn handle(
    db: &DatabaseConnection,
    state: &Arc<AppState>,
    job_id: Uuid,
    params: &JsonValue,
    user_id: Option<Uuid>,
    cancel: &CancellationToken,
) -> Result<JsonValue, AppError> {
    let library_id = string_param(params, "photoLibraryId")
        .ok_or_else(|| AppError::BadRequest("missing photoLibraryId".into()))?
        .parse::<Uuid>()
        .map_err(|_| AppError::BadRequest("invalid photoLibraryId".into()))?;
    let user_id = user_id.ok_or_else(|| AppError::Unauthorized("missing job user".into()))?;
    let clear_data = bool_param(params, "clearData");

    let library = PhotoLibraryRepo::get_by_id(db, library_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("photo library {library_id} not found")))?;

    PhotoLibraryRepo::update_sync_status(db, library_id, "syncing", None).await?;

    for task_type in [
        "photo_ocr_scan",
        "photo_clip_scan",
        "photo_face_scan",
        "photo_geocode_scan",
    ] {
        crate::services::preempt::preempt_scan_for(state, library_id, task_type).await?;
    }

    let client = state
        .bus_client
        .get()
        .ok_or_else(|| AppError::Internal("bus client not initialized".into()))?;
    let sync_job = SyncJobContext {
        job_id,
        user_id,
        client: Arc::clone(client),
        cancel: cancel.clone(),
    };

    match AppSyncService::execute_photo_sync(
        db,
        &state.sources,
        &state.bus_client,
        library_id,
        clear_data,
        user_id,
        Some(&sync_job),
    )
    .await
    {
        Ok(result) => {
            photo_notify::notify_sync_completed(state, user_id, library_id, &library.name, result.total_jobs).await;
            Ok(json!({
                "phase": "completed",
                "photoLibraryId": library_id.to_string(),
                "totalJobs": result.total_jobs,
                "scannedFiles": result.scanned_files,
                "skippedFiles": result.skipped_files,
                "queuedJobs": result.queued_jobs,
                "backfilledChecksums": result.backfilled_checksums,
                "visitedDirs": result.visited_dirs,
            }))
        }
        Err(error) => {
            if !matches!(error, AppError::Gone(_)) {
                photo_notify::notify_sync_failed(state, user_id, library_id, &library.name, &error.to_string()).await;
            }
            Err(error)
        }
    }
}
