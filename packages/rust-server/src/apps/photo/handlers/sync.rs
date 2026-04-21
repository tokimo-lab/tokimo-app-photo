use axum::{
    extract::{Path, State},
    response::Json,
};
use std::sync::Arc;
use tracing::{error, info};
use uuid::Uuid;

use crate::AppState;
use crate::apps::photo::repos::PhotoLibraryRepo;
use crate::apps::photo::services::notifications as photo_notify;
use crate::db::repos::job_repo::JobRepo;
use crate::error::AppError;
use crate::error::OptionExt;
use crate::handlers::user::AuthUser;
use crate::handlers::{ApiResponse, ok};
use crate::services::media::app_sync::AppSyncService;

use super::parse_uuid;

// ── DTOs ──

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoSyncInput {
    pub clear_data: Option<bool>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncProgressOutput {
    pub app_id: String,
    pub status: String,
    pub total: i64,
    pub completed: i64,
    pub running: i64,
    pub pending: i64,
    pub failed: i64,
    pub tasks: Vec<TaskProgress>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskProgress {
    pub task_type: String,
    pub status: String,
    pub total_items: i64,
    pub processed_items: i64,
}

/// POST /api/apps/photo/{id}/sync
///
/// Triggers an async photo library sync.
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

    if clear_data {
        AppSyncService::clear_library_data(&state.db, uid, "photo").await?;
    }

    PhotoLibraryRepo::update_sync_status(&state.db, uid, "syncing", None).await?;

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
                photo_notify::notify_sync_completed(
                    &state_for_task,
                    user_id,
                    uid,
                    &library_name,
                    result.total_jobs,
                )
                .await;
            }
            Err(e) => {
                error!("photo sync failed: {e}");
                photo_notify::notify_sync_failed(
                    &state_for_task,
                    user_id,
                    uid,
                    &library_name,
                    &e.to_string(),
                )
                .await;
            }
        }
    });

    Ok(ok(serde_json::json!({ "success": true })))
}

/// GET /api/apps/photo/{id}/sync-progress
///
/// Returns job counts and per-type task breakdown for a photo library.
pub async fn get_photo_sync_progress(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<SyncProgressOutput>>, AppError> {
    let uid = parse_uuid(&id)?;
    let lib = PhotoLibraryRepo::get_by_id(&state.db, uid)
        .await?
        .not_found(format!("photo library {id} not found"))?;

    let job_types = &[
        "file_scrape",
        "photo_ocr",
        "photo_clip",
        "photo_face_detect",
        "photo_reverse_geocode",
    ];
    let (total, completed, running, pending, failed) = JobRepo::count_jobs_by_app(&state.db, uid, job_types).await?;

    let rows = JobRepo::get_task_progress_by_app(&state.db, uid, job_types).await?;
    let tasks: Vec<TaskProgress> = rows
        .into_iter()
        .map(|row| {
            let status = if row.running > 0 {
                "running"
            } else if row.pending > 0 {
                "pending"
            } else if row.failed > 0 && row.completed == 0 {
                "failed"
            } else {
                "completed"
            };

            let (total_items, processed_items) = if row.job_type == "file_scrape" {
                let t = row.completed + row.running + row.pending + row.failed;
                (t, row.completed)
            } else if let Some(ref meta) = row.running_meta {
                let t = meta.get("total").and_then(sea_orm::JsonValue::as_i64).unwrap_or(0);
                let p = meta.get("processed").and_then(sea_orm::JsonValue::as_i64).unwrap_or(0);
                (t, p)
            } else {
                (0, 0)
            };

            TaskProgress {
                task_type: row.job_type,
                status: status.to_string(),
                total_items,
                processed_items,
            }
        })
        .collect();

    Ok(ok(SyncProgressOutput {
        app_id: uid.to_string(),
        status: lib.sync_status,
        total,
        completed,
        running,
        pending,
        failed,
        tasks,
    }))
}
