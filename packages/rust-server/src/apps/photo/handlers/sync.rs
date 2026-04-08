use axum::{
    extract::{Path, State},
    response::Json,
};
use std::sync::Arc;

use crate::db::repos::job_repo::JobRepo;
use crate::db::repos::photo_repo::PhotoLibraryRepo;
use crate::error::AppError;
use crate::error::OptionExt;
use crate::handlers::{ok, ApiResponse};
use crate::handlers::app::{SyncProgressOutput, TaskProgress};
use crate::AppState;

use super::parse_uuid;

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
    let (total, completed, running, pending, failed) =
        JobRepo::count_jobs_by_app(&state.db, uid, job_types).await?;

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
