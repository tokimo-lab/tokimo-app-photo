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
use crate::error::AppError;

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
        .and_then(|v| v.as_bool())
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
    let hidden: bool = body.get("hidden").and_then(|v| v.as_bool()).unwrap_or(true);
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
    State(_ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let _uid = parse_uuid(&id)?;
    tracing::warn!("rescan not yet implemented");
    ok_simple()
}
