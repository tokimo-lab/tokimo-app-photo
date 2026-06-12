use axum::{
    Json,
    extract::{Path, Query, State},
};
use serde::Deserialize;
use std::sync::Arc;
use uuid::Uuid;

use crate::AppCtx;
use crate::db::repos::PhotoRepo;
use crate::db::pagination::PageInput;
use crate::error::AppError;
use crate::error::{ApiResponse, ok};

use super::parse_uuid;

/// GET /api/apps/photo/{id}/photo-albums
pub async fn list_photo_albums(
    State(state): State<Arc<AppCtx>>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let uid = parse_uuid(&id)?;
    let albums = PhotoRepo::list_albums(&state.db, uid).await?;
    Ok(ok(serde_json::to_value(albums).unwrap()))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAlbumBody {
    pub name: String,
    pub description: Option<String>,
}

/// POST /api/apps/photo/{id}/photo-albums
pub async fn create_album(
    State(state): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Json(body): Json<CreateAlbumBody>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let uid = parse_uuid(&id)?;
    let album = PhotoRepo::create_album(&state.db, uid, &body.name, body.description.as_deref()).await?;
    Ok(ok(serde_json::to_value(album).unwrap()))
}

/// DELETE /api/photo-albums/{id}
pub async fn delete_album(
    State(state): State<Arc<AppCtx>>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let uid = parse_uuid(&id)?;
    PhotoRepo::delete_album(&state.db, uid).await?;
    Ok(ok(serde_json::json!({ "success": true })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumPhotosBody {
    pub photo_ids: Vec<String>,
}

/// POST /api/photo-albums/{id}/add-photos
pub async fn add_photos_to_album(
    State(state): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Json(body): Json<AlbumPhotosBody>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let album_id = parse_uuid(&id)?;
    let photo_ids: Vec<Uuid> = body.photo_ids.iter().map(|s| parse_uuid(s)).collect::<Result<_, _>>()?;
    let count = PhotoRepo::add_photos_to_album(&state.db, album_id, &photo_ids).await?;
    Ok(ok(serde_json::json!({ "photoCount": count })))
}

/// POST /api/photo-albums/{id}/remove-photos
pub async fn remove_photos_from_album(
    State(state): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Json(body): Json<AlbumPhotosBody>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let album_id = parse_uuid(&id)?;
    let photo_ids: Vec<Uuid> = body.photo_ids.iter().map(|s| parse_uuid(s)).collect::<Result<_, _>>()?;
    let count = PhotoRepo::remove_photos_from_album(&state.db, album_id, &photo_ids).await?;
    Ok(ok(serde_json::json!({ "photoCount": count })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumPhotosQuery {
    pub page: Option<u64>,
    pub page_size: Option<u64>,
}

/// GET /api/photo-albums/{id}/photos
pub async fn list_album_photos(
    State(state): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Query(q): Query<AlbumPhotosQuery>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let album_id = parse_uuid(&id)?;
    let page_input = PageInput {
        page: q.page.unwrap_or(1),
        page_size: q.page_size.unwrap_or(60),
    };
    let result = PhotoRepo::list_album_photos(&state.db, album_id, &page_input).await?;
    Ok(ok(serde_json::to_value(result)?))
}
