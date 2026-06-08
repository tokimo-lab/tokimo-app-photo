//! Handlers for triggering photo library sync.

use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, State},
};
use serde::Deserialize;
use uuid::Uuid;

use crate::ctx::AppCtx;
use crate::db::repos::library_repo::PhotoLibraryRepo;
use crate::error::{AppError, OptionExt};
use crate::handlers::user::AuthUser;
use crate::services::app_sync::AppSyncService;

use super::{ok, parse_uuid};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoSyncInput {
    pub clear_data: Option<bool>,
}

pub async fn sync_photo(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    auth: AuthUser,
    body: Option<Json<PhotoSyncInput>>,
) -> Result<Json<serde_json::Value>, AppError> {
    let caller_user_id: Uuid = auth
        .user_id
        .parse()
        .map_err(|_| AppError::Unauthorized("invalid user_id in auth token".into()))?;
    let uid: Uuid = parse_uuid(&id)?;

    let library = PhotoLibraryRepo::get_by_id(&ctx.db, uid)
        .await?
        .not_found(format!("photo library {id} not found"))?;

    let clear_data = body.as_ref().and_then(|b| b.clear_data).unwrap_or(false);

    if library.sync_status == "syncing" && !clear_data {
        return Err(AppError::Conflict(
            "Photo library is already syncing".into(),
        ));
    }

    // Mark library as syncing
    PhotoLibraryRepo::update_sync_status(&ctx.db, uid, "syncing", None).await?;

    // Phase 1: VFS walk + photo import (creates photo_scrape jobs)
    let db = ctx.db.clone();
    let sources = Arc::clone(&ctx.sources);
    let bus_client = Arc::clone(&ctx.client);
    tokio::spawn(async move {
        match AppSyncService::execute_photo_sync(
            &db,
            &sources,
            &bus_client,
            uid,
            clear_data,
            caller_user_id,
        )
        .await
        {
            Ok(result) => {
                tracing::info!(
                    "photo sync walk completed for library {}: {} jobs dispatched",
                    uid,
                    result.total_jobs
                );
            }
            Err(e) => {
                tracing::error!("photo sync walk failed for library {}: {}", uid, e);
                let _ = PhotoLibraryRepo::update_sync_status(&db, uid, "failed", None).await;
                return;
            }
        }

        // Phase 2: Create AI scan jobs (CLIP, face, OCR, geocode)
        let client = bus_client.get().expect("bus client not initialized");
        let scan_job_types = [
            "photo_clip_scan",
            "photo_face_scan",
            "photo_ocr_scan",
            "photo_geocode_scan",
        ];

        for scan_job_type in scan_job_types {
            let req = crate::bus_clients::jobs::CreateJobRequest::new(
                scan_job_type,
                serde_json::json!({
                    "photoLibraryId": uid.to_string(),
                    "libraryId": uid.to_string(),
                    "clearData": clear_data,
                }),
            );

            match crate::bus_clients::jobs::create(
                client,
                crate::bus_clients::jobs::photo_caller(Some(caller_user_id)),
                req,
            )
            .await
            {
                Ok(job) => {
                    tracing::info!(
                        "dispatched {} job {:?} for library {}",
                        scan_job_type,
                        job.id,
                        uid
                    );
                }
                Err(e) => {
                    tracing::warn!("failed to dispatch {} job: {e}", scan_job_type);
                }
            }
        }

        // Notify frontend that sync has started
        let _ = crate::bus_clients::app_events::emit_entity(
            client,
            caller_user_id,
            "photo_library",
            Some(format!("library:{uid}")),
            serde_json::json!({ "id": uid.to_string(), "operation": "syncing", "libraryId": uid.to_string() }),
        )
        .await;
    });

    ok(serde_json::json!({ "success": true }))
}
