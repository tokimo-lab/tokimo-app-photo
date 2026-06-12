use axum::{
    extract::{Path, State},
    response::Json,
};
use std::sync::Arc;
use tracing::{error, info};
use uuid::Uuid;

use crate::AppCtx;
use crate::db::repos::PhotoLibraryRepo;
use crate::services::notifications as photo_notify;
use crate::error::AppError;
use crate::error::OptionExt;
use crate::handlers::user::AuthUser;
use crate::error::{ApiResponse, ok};
use crate::services::app_sync::AppSyncService;

// ── DTOs ──

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoSyncInput {
    pub clear_data: Option<bool>,
}

/// POST /api/apps/photo/{id}/sync
///
/// Triggers an async photo library sync.
pub async fn sync_photo(
    State(state): State<Arc<AppCtx>>,
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

    if clear_data {
        AppSyncService::clear_library_data(&state.db, uid, "photo").await?;
    }

    PhotoLibraryRepo::update_sync_status(&state.db, uid, "syncing", None).await?;

    // Preempt any still-active same-library scans of the 4 kinds this
    // sync-all endpoint will re-dispatch, so the previous attempt's jobs
    // don't intermix with the new run.
    for task_type in [
        "photo_ocr_scan",
        "photo_clip_scan",
        "photo_face_scan",
        "photo_geocode_scan",
    ] {
        crate::services::preempt::preempt_scan_for(&state, uid, task_type).await?;
    }

    let user_id: Uuid = auth
        .user_id
        .parse()
        .map_err(|_| AppError::Unauthorized("invalid auth user id".into()))?;

    let db = state.db.clone();
    let sources = state.sources.clone();
    let storage = state.storage.clone();
    let state_for_task = state.clone();
    let library_name = library.name.clone();

    tokio::spawn(async move {
        match AppSyncService::execute_photo_sync(&db, &sources, &storage, uid, false, Some(user_id)).await {
            Ok(result) => {
                info!("photo sync completed, {} jobs dispatched", result.total_jobs);
                photo_notify::notify_sync_completed(&state_for_task, user_id, uid, &library_name, result.total_jobs)
                    .await;
            }
            Err(e) => {
                error!("photo sync failed: {e}");
                photo_notify::notify_sync_failed(&state_for_task, user_id, uid, &library_name, &e.to_string()).await;
            }
        }
    });

    Ok(ok(serde_json::json!({ "success": true })))
}
