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

    // VFS walk + photo import (creates file_scrape jobs).
    // AI scan jobs (CLIP, face, OCR, geocode) are triggered manually via UI buttons,
    // matching monolith behavior.
    let db = ctx.db.clone();
    let sources = Arc::clone(&ctx.sources);
    let bus_client = Arc::clone(&ctx.client);
    tokio::spawn(async move {
        // Notify frontend that sync has started
        if let Some(client) = bus_client.get() {
            let _ = crate::bus_clients::app_events::emit_entity(
                client,
                caller_user_id,
                "photo_library",
                Some(format!("library:{uid}")),
                serde_json::json!({ "id": uid.to_string(), "operation": "syncing", "libraryId": uid.to_string() }),
            )
            .await;
        }

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
                    "photo sync completed for library {}: {} jobs dispatched",
                    uid,
                    result.total_jobs
                );
            }
            Err(e) => {
                tracing::error!("photo sync failed for library {}: {}", uid, e);
                let _ = PhotoLibraryRepo::update_sync_status(&db, uid, "failed", None).await;
            }
        }
    });

    ok(serde_json::json!({ "success": true }))
}
