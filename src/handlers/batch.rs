//! Handlers for batch photo operations — favorite, delete, hide, trash.

use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, Query, State},
};
use serde::Deserialize;
use uuid::Uuid;

use crate::ctx::AppCtx;
use crate::db::{pagination::PageInput, repos::photo_repo::PhotoRepo};
use crate::error::{AppError, OptionExt};

use super::{ok, ok_simple, parse_uuid};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchPhotoIdsInput {
    pub photo_ids: Vec<String>,
}

fn parse_ids(ids: &[String]) -> Vec<Uuid> {
    ids.iter().filter_map(|s| s.parse::<Uuid>().ok()).collect()
}

pub async fn batch_favorite(
    State(ctx): State<Arc<AppCtx>>,
    Path(_id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, AppError> {
    let photo_ids: Vec<String> = body
        .get("photoIds")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    let favorite: bool = body
        .get("favorite")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(true);
    let ids = parse_ids(&photo_ids);
    let count = PhotoRepo::batch_set_favorite(&ctx.db, &ids, favorite).await?;
    ok(serde_json::json!({ "updated": count }))
}

pub async fn batch_delete(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Json(body): Json<BatchPhotoIdsInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    let app_id = parse_uuid(&id)?;
    let ids = parse_ids(&body.photo_ids);
    let count = PhotoRepo::batch_delete(&ctx.db, app_id, &ids).await?;
    ok(serde_json::json!({ "deleted": count }))
}

pub async fn batch_hide(
    State(ctx): State<Arc<AppCtx>>,
    Path(_id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, AppError> {
    let photo_ids: Vec<String> = body
        .get("photoIds")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    let hidden: bool = body.get("hidden").and_then(serde_json::Value::as_bool).unwrap_or(true);
    let ids = parse_ids(&photo_ids);
    let count = PhotoRepo::batch_set_hidden(&ctx.db, &ids, hidden).await?;
    ok(serde_json::json!({ "updated": count }))
}

// ── Trash ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashPhotosInput {
    pub photo_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct ListTrashedQuery {
    pub page: Option<u64>,
    pub page_size: Option<u64>,
}

pub async fn list_trashed(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Query(q): Query<ListTrashedQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let app_id = parse_uuid(&id)?;
    let page = PageInput {
        page: q.page.unwrap_or(1),
        page_size: q.page_size.unwrap_or(60),
    };
    let result = PhotoRepo::list_trashed(&ctx.db, app_id, &page).await?;
    ok(result)
}

pub async fn trash_photos(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Json(body): Json<TrashPhotosInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    let app_id = parse_uuid(&id)?;
    let ids = parse_ids(&body.photo_ids);
    let count = PhotoRepo::trash_photos(&ctx.db, app_id, &ids).await?;
    ok(serde_json::json!({ "trashed": count }))
}

pub async fn restore_photos(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Json(body): Json<TrashPhotosInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    let app_id = parse_uuid(&id)?;
    let ids = parse_ids(&body.photo_ids);
    let count = PhotoRepo::restore_photos(&ctx.db, app_id, &ids).await?;
    ok(serde_json::json!({ "restored": count }))
}

pub async fn permanent_delete(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Json(body): Json<TrashPhotosInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    let app_id = parse_uuid(&id)?;
    let ids = parse_ids(&body.photo_ids);
    let count = PhotoRepo::permanent_delete(&ctx.db, app_id, &ids).await?;
    ok(serde_json::json!({ "deleted": count }))
}

pub async fn rescan(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let uid = parse_uuid(&id)?;

    let library = crate::db::repos::library_repo::PhotoLibraryRepo::get_by_id(&ctx.db, uid)
        .await?
        .not_found(format!("photo library {id} not found"))?;

    if library.sync_status == "syncing" {
        return Err(AppError::Conflict(
            "Photo library is already syncing".into(),
        ));
    }

    // Mark library as syncing
    crate::db::repos::library_repo::PhotoLibraryRepo::update_sync_status(&ctx.db, uid, "syncing", None).await?;

    // Trigger VFS walk + photo import in background
    let db = ctx.db.clone();
    let sources = Arc::clone(&ctx.sources);
    let bus_client = Arc::clone(&ctx.client);
    tokio::spawn(async move {
        match crate::services::app_sync::AppSyncService::execute_photo_sync(
            &db,
            &sources,
            &bus_client,
            uid,
            false, // don't clear existing data
            Uuid::nil(),
        )
        .await
        {
            Ok(result) => {
                tracing::info!(
                    "photo rescan completed for library {}: {} jobs dispatched",
                    uid,
                    result.total_jobs
                );
            }
            Err(e) => {
                tracing::error!("photo rescan failed for library {}: {}", uid, e);
                let _ = crate::db::repos::library_repo::PhotoLibraryRepo::update_sync_status(
                    &db, uid, "failed", None,
                )
                .await;
            }
        }
    });

    ok_simple()
}
