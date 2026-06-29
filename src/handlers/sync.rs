use axum::{
    extract::{Path, State},
    response::Json,
};
use std::collections::HashMap;
use std::sync::Arc;
use uuid::Uuid;

use crate::AppState;
use crate::bus_clients::jobs::{self as jobs_client, CreateJobRequest, JobFilter};
use crate::error::AppError;
use crate::error::OptionExt;
use crate::handlers::user::AuthUser;
use crate::handlers::{ApiResponse, ok};
use crate::queue::JobPriority;
use crate::repos::PhotoLibraryRepo;
use crate::services::app_sync::PHOTO_LIBRARY_SYNC_JOB_TYPE;

// ── DTOs ──

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoSyncInput {
    pub clear_data: Option<bool>,
}

fn sync_job_filter(library_id: Uuid) -> JobFilter {
    let mut params_match = HashMap::new();
    params_match.insert("photoLibraryId".to_string(), library_id.to_string());
    JobFilter {
        status: None,
        job_type: Some(PHOTO_LIBRARY_SYNC_JOB_TYPE.to_string()),
        params_match: Some(params_match),
        parents_only: Some(true),
    }
}

/// POST /api/apps/photo/{id}/sync
///
/// Enqueues a photo library sync job.
pub async fn sync_photo(
    State(state): State<Arc<AppState>>,
    AuthUser(auth): AuthUser,
    Path(id): Path<String>,
    body: Option<Json<PhotoSyncInput>>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let uid: Uuid = id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid photo library id".into()))?;

    let library = PhotoLibraryRepo::get_by_id(&state.db, uid)
        .await?
        .not_found(format!("photo library {id} not found"))?;

    let clear_data = body.and_then(|b| b.clear_data).unwrap_or(false);

    if library.sync_status == "syncing" && !clear_data {
        return Err(AppError::Conflict("Photo library is already syncing".into()));
    }

    let user_id: Uuid = auth
        .user_id
        .parse()
        .map_err(|_| AppError::Unauthorized("invalid auth user id".into()))?;

    let bus_client = state
        .bus_client
        .get()
        .ok_or_else(|| AppError::Internal("bus client not initialized".into()))?;

    if clear_data {
        let _ = jobs_client::preempt(
            bus_client,
            jobs_client::photo_caller(Some(user_id)),
            sync_job_filter(uid),
            "被新的资料库同步覆盖",
        )
        .await?;
    }

    let mut request = CreateJobRequest::new(
        PHOTO_LIBRARY_SYNC_JOB_TYPE,
        serde_json::json!({
            "photoLibraryId": uid.to_string(),
            "clearData": clear_data,
        }),
    )
    .with_data(Some(serde_json::json!({
        "phase": "pending",
        "photoLibraryId": uid.to_string(),
        "scannedFiles": 0,
        "skippedFiles": 0,
        "queuedJobs": 0,
        "backfilledChecksums": 0,
        "visitedDirs": 0,
    })));
    request.dedupe_key = Some(format!("photo:{uid}:{PHOTO_LIBRARY_SYNC_JOB_TYPE}"));
    request.priority = Some(JobPriority::UserAction.as_i32());

    let job = jobs_client::enqueue_with_dedupe(bus_client, jobs_client::photo_caller(Some(user_id)), request).await?;
    PhotoLibraryRepo::update_sync_status(&state.db, uid, "syncing", None).await?;

    Ok(ok(serde_json::json!({
        "success": true,
        "jobId": job.id,
    })))
}
