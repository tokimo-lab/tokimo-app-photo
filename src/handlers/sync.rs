//! Handlers for triggering photo library sync.

use std::sync::Arc;

use axum::{Json, extract::{Path, State}};
use serde::Deserialize;
use uuid::Uuid;

use crate::ctx::AppCtx;
use crate::db::repos::library_repo::PhotoLibraryRepo;
use crate::error::{AppError, OptionExt};

use super::{ok, parse_uuid};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoSyncInput {
    pub clear_data: Option<bool>,
}

pub async fn sync_photo(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    body: Option<Json<PhotoSyncInput>>,
) -> Result<Json<serde_json::Value>, AppError> {
    let uid: Uuid = parse_uuid(&id)?;

    let library = PhotoLibraryRepo::get_by_id(&ctx.db, uid)
        .await?
        .not_found(format!("photo library {id} not found"))?;

    if library.sync_status == "syncing" && !body.as_ref().and_then(|b| b.clear_data).unwrap_or(false) {
        return Err(AppError::Conflict("Photo library is already syncing".into()));
    }

    // Mark library as pending sync
    PhotoLibraryRepo::update_sync_status(&ctx.db, uid, "pending", None).await?;

    // Dispatch job via bus
    let client = ctx.client();
    let req = crate::bus_clients::jobs::CreateJobRequest::new(
        "photo_scan",
        serde_json::json!({ "libraryId": uid.to_string() }),
    );
    match crate::bus_clients::jobs::create(&client, crate::bus_clients::jobs::photo_caller(None), req).await {
        Ok(job) => {
            tracing::info!("dispatched photo_scan job {:?} for library {}", job.id, uid);
        }
        Err(e) => {
            tracing::warn!("failed to dispatch photo_scan job: {e}");
            // Revert to idle so the user can retry
            let _ = PhotoLibraryRepo::update_sync_status(&ctx.db, uid, "idle", None).await;
            return Err(AppError::Internal(format!("failed to dispatch sync job: {e}")));
        }
    }

    ok(serde_json::json!({ "success": true }))
}
