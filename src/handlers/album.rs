//! Handlers for photo album management.

use std::sync::Arc;

use axum::{Json, extract::{Path, Query, State}};
use serde::Deserialize;
use uuid::Uuid;

use crate::ctx::AppCtx;
use crate::db::{pagination::PageInput, repos::photo_repo::PhotoRepo};
use crate::error::AppError;

use super::{ok, ok_simple, parse_uuid};

// ── List albums ───────────────────────────────────────────────────────────────

pub async fn list_photo_albums(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let uid = parse_uuid(&id)?;
    let albums = PhotoRepo::list_albums(&ctx.db, uid).await?;
    ok(albums)
}

// ── Create album ──────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAlbumInput {
    pub name: String,
    pub description: Option<String>,
}

pub async fn create_album(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Json(body): Json<CreateAlbumInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    let uid = parse_uuid(&id)?;
    let album = PhotoRepo::create_album(&ctx.db, uid, &body.name, body.description.as_deref()).await?;
    ok(album)
}

// ── Delete album ──────────────────────────────────────────────────────────────

pub async fn delete_album(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let uid = parse_uuid(&id)?;
    PhotoRepo::delete_album(&ctx.db, uid).await?;
    ok_simple()
}

// ── Album photos ──────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumPhotosQuery {
    pub page: Option<u64>,
    pub page_size: Option<u64>,
}

pub async fn list_album_photos(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Query(q): Query<AlbumPhotosQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let uid = parse_uuid(&id)?;
    let page = PageInput {
        page: q.page.unwrap_or(1),
        page_size: q.page_size.unwrap_or(60),
    };
    let result = PhotoRepo::list_album_photos(&ctx.db, uid, &page).await?;
    ok(result)
}

// ── Add / remove photos ───────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumPhotoIdsInput {
    pub photo_ids: Vec<String>,
}

pub async fn add_photos_to_album(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Json(body): Json<AlbumPhotoIdsInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    let album_id = parse_uuid(&id)?;
    let photo_ids: Vec<Uuid> = body
        .photo_ids
        .iter()
        .filter_map(|s| s.parse::<Uuid>().ok())
        .collect();
    let count = PhotoRepo::add_photos_to_album(&ctx.db, album_id, &photo_ids).await?;
    ok(serde_json::json!({ "count": count }))
}

pub async fn remove_photos_from_album(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Json(body): Json<AlbumPhotoIdsInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    let album_id = parse_uuid(&id)?;
    let photo_ids: Vec<Uuid> = body
        .photo_ids
        .iter()
        .filter_map(|s| s.parse::<Uuid>().ok())
        .collect();
    let count = PhotoRepo::remove_photos_from_album(&ctx.db, album_id, &photo_ids).await?;
    ok(serde_json::json!({ "count": count }))
}
