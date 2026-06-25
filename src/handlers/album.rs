use axum::{
    Json,
    extract::{Path, Query, State},
    http::Request,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

use crate::AppState;
use crate::db::pagination::PageInput;
use crate::error::AppError;
use crate::handlers::{ApiResponse, ok};
use crate::handlers::user::AuthUser;
use crate::bus_clients::share;
use crate::models::{PhotoAlbumOutput, PhotoAlbumSourceInput, PhotoOutput};
use crate::repos::PhotoRepo;
use crate::services::clip::{ClipSearchResult, PhotoClipService};

use super::parse_uuid;

/// GET /api/apps/photo/{id}/photo-albums
pub async fn list_photo_albums(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(q): Query<AlbumListQuery>,
    auth: AuthUser,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let uid = parse_uuid(&id)?;
    let user_id = parse_uuid(&auth.user_id)?;
    let albums = PhotoRepo::list_albums(&state.db, uid, user_id, q.scope.as_deref().unwrap_or("all")).await?;
    Ok(ok(serde_json::to_value(albums).unwrap()))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumListQuery {
    pub scope: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAlbumBody {
    pub name: String,
    pub description: Option<String>,
    pub source: Option<PhotoAlbumSourceInput>,
}

/// POST /api/apps/photo/{id}/photo-albums
pub async fn create_album(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    auth: AuthUser,
    Json(body): Json<CreateAlbumBody>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let uid = parse_uuid(&id)?;
    let user_id = parse_uuid(&auth.user_id)?;
    let album = PhotoRepo::create_album(&state.db, uid, user_id, &body.name, body.description.as_deref(), body.source).await?;
    Ok(ok(serde_json::to_value(album).unwrap()))
}

/// DELETE /api/photo-albums/{id}
pub async fn delete_album(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    auth: AuthUser,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let uid = parse_uuid(&id)?;
    let user_id = parse_uuid(&auth.user_id)?;
    if !PhotoRepo::can_manage_album(&state.db, uid, user_id).await? {
        return Err(AppError::Forbidden("Only album owner can delete this album".into()));
    }
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
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    auth: AuthUser,
    Json(body): Json<AlbumPhotosBody>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let album_id = parse_uuid(&id)?;
    let user_id = parse_uuid(&auth.user_id)?;
    if !PhotoRepo::can_manage_album(&state.db, album_id, user_id).await? {
        return Err(AppError::Forbidden("Only album owner can edit this album".into()));
    }
    let photo_ids: Vec<Uuid> = body.photo_ids.iter().map(|s| parse_uuid(s)).collect::<Result<_, _>>()?;
    let count = PhotoRepo::add_photos_to_album(&state.db, album_id, &photo_ids).await?;
    Ok(ok(serde_json::json!({ "photoCount": count })))
}

/// POST /api/photo-albums/{id}/remove-photos
pub async fn remove_photos_from_album(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    auth: AuthUser,
    Json(body): Json<AlbumPhotosBody>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let album_id = parse_uuid(&id)?;
    let user_id = parse_uuid(&auth.user_id)?;
    if !PhotoRepo::can_manage_album(&state.db, album_id, user_id).await? {
        return Err(AppError::Forbidden("Only album owner can edit this album".into()));
    }
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
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(q): Query<AlbumPhotosQuery>,
    auth: AuthUser,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let album_id = parse_uuid(&id)?;
    let user_id = parse_uuid(&auth.user_id)?;
    if !PhotoRepo::can_view_album(&state.db, album_id, user_id).await? {
        return Err(AppError::Forbidden("Album is not shared with this user".into()));
    }
    let page_input = PageInput {
        page: q.page.unwrap_or(1),
        page_size: q.page_size.unwrap_or(60),
    };
    let album = PhotoRepo::get_album(&state.db, album_id).await?;
    let result = if album.album_type == "clip" {
        let query = album
            .source_ref
            .as_deref()
            .ok_or_else(|| AppError::BadRequest("clip album missing source_ref".into()))?;
        clip_results_to_page(PhotoClipService::search(&state.db, &state, album.app_id, query).await?, &page_input)
    } else {
        PhotoRepo::list_album_photos_for_album(&state.db, &album, &page_input).await?
    };
    Ok(ok(serde_json::to_value(result)?))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumShareStatus {
    pub link_enabled: bool,
    pub token: Option<String>,
    pub url: Option<String>,
    pub users: Vec<AlbumUserShareOutput>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumUserShareOutput {
    pub user_id: String,
    pub permission: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchShareLinkBody {
    pub enabled: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PutUserShareBody {
    pub user_id: String,
}

pub async fn get_album_share(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    auth: AuthUser,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let album_id = parse_uuid(&id)?;
    let user_id = parse_uuid(&auth.user_id)?;
    if !PhotoRepo::can_manage_album(&state.db, album_id, user_id).await? {
        return Err(AppError::Forbidden("Only album owner can manage sharing".into()));
    }
    let users = PhotoRepo::list_album_user_shares(&state.db, album_id)
        .await?
        .into_iter()
        .map(|s| AlbumUserShareOutput {
            user_id: s.user_id.to_string(),
            permission: s.permission,
        })
        .collect();
    let link = match state.bus_client.get() {
        Some(client) => {
            let caller = share::photo_caller(Some(user_id));
            Some(share::get_link(client, caller, "photo_album", album_id).await?)
        }
        None => None,
    };
    Ok(ok(serde_json::to_value(AlbumShareStatus {
        link_enabled: link.as_ref().is_some_and(|l| l.enabled),
        token: link.as_ref().and_then(|l| l.token.clone()),
        url: link.as_ref().and_then(|l| l.url.clone()),
        users,
    })?))
}

pub async fn patch_album_share_link(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    auth: AuthUser,
    Json(body): Json<PatchShareLinkBody>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let album_id = parse_uuid(&id)?;
    let user_id = parse_uuid(&auth.user_id)?;
    if !PhotoRepo::can_manage_album(&state.db, album_id, user_id).await? {
        return Err(AppError::Forbidden("Only album owner can manage sharing".into()));
    }
    let album = PhotoRepo::get_album(&state.db, album_id).await?;
    let client = state
        .bus_client
        .get()
        .ok_or_else(|| AppError::Internal("share registry is not connected".into()))?;
    let output = PhotoRepo::album_output(&state.db, album).await?;
    let link = share::upsert_link(
        client,
        share::photo_caller(Some(user_id)),
        share::UpsertShareLinkRequest {
            resource_type: "photo_album".to_string(),
            resource_id: album_id,
            resource_name: output.name,
            cover_image: output.cover_photo_id.map(|id| format!("/api/thumb/photo/{id}")),
            enabled: body.enabled,
        },
    )
    .await?;
    let users = PhotoRepo::list_album_user_shares(&state.db, album_id)
        .await?
        .into_iter()
        .map(|s| AlbumUserShareOutput {
            user_id: s.user_id.to_string(),
            permission: s.permission,
        })
        .collect();
    Ok(ok(serde_json::to_value(AlbumShareStatus {
        link_enabled: link.enabled,
        token: link.token,
        url: link.url,
        users,
    })?))
}

pub async fn put_album_user_share(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    auth: AuthUser,
    Json(body): Json<PutUserShareBody>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let album_id = parse_uuid(&id)?;
    let owner_id = parse_uuid(&auth.user_id)?;
    if !PhotoRepo::can_manage_album(&state.db, album_id, owner_id).await? {
        return Err(AppError::Forbidden("Only album owner can manage sharing".into()));
    }
    let target_user_id = parse_uuid(&body.user_id)?;
    PhotoRepo::upsert_album_user_share(&state.db, album_id, target_user_id, owner_id).await?;
    get_album_share(State(state), Path(id), auth).await
}

pub async fn delete_album_user_share(
    State(state): State<Arc<AppState>>,
    Path((id, user_id)): Path<(String, String)>,
    auth: AuthUser,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let album_id = parse_uuid(&id)?;
    let owner_id = parse_uuid(&auth.user_id)?;
    if !PhotoRepo::can_manage_album(&state.db, album_id, owner_id).await? {
        return Err(AppError::Forbidden("Only album owner can manage sharing".into()));
    }
    let target_user_id = parse_uuid(&user_id)?;
    PhotoRepo::delete_album_user_share(&state.db, album_id, target_user_id).await?;
    get_album_share(State(state), Path(id), auth).await
}

pub async fn public_album_by_token(
    State(state): State<Arc<AppState>>,
    Path(token): Path<String>,
    Query(q): Query<AlbumPhotosQuery>,
) -> Response {
    let Some(client) = state.bus_client.get() else {
        return AppError::Internal("share registry is not connected".into()).into_response();
    };
    let link = match share::resolve_public(client, share::photo_caller(None), &token, "photo_album").await {
        Ok(link) => link,
        Err(e) => return e.into_response(),
    };
    let Some(album_id) = link.resource_id else {
        return AppError::NotFound("share link has no album resource".into()).into_response();
    };
    let page_input = PageInput {
        page: q.page.unwrap_or(1),
        page_size: q.page_size.unwrap_or(60),
    };
    let album = match PhotoRepo::get_album(&state.db, album_id).await {
        Ok(album) => album,
        Err(e) => return e.into_response(),
    };
    let photos = if album.album_type == "clip" {
        let Some(query) = album.source_ref.as_deref() else {
            return AppError::BadRequest("clip album missing source_ref".into()).into_response();
        };
        match PhotoClipService::search(&state.db, &state, album.app_id, query).await {
            Ok(results) => clip_results_to_page(results, &page_input),
            Err(e) => return e.into_response(),
        }
    } else {
        match PhotoRepo::list_album_photos_for_album(&state.db, &album, &page_input).await {
            Ok(page) => page,
            Err(e) => return e.into_response(),
        }
    };
    let album_output = if album.album_type == "clip" {
        let mut output = PhotoAlbumOutput::from(album);
        output.photo_count = photos.total as i32;
        output.cover_photo_id = photos.items.first().map(|item| item.id);
        output
    } else {
        match PhotoRepo::album_output(&state.db, album).await {
            Ok(output) => output,
            Err(e) => return e.into_response(),
        }
    };
    ok(serde_json::json!({
        "album": album_output,
        "photos": photos,
    }))
    .into_response()
}

pub async fn public_album_photo_image(
    State(state): State<Arc<AppState>>,
    Path((token, photo_id)): Path<(String, String)>,
    Query(q): Query<crate::handlers::stream::ImageQuery>,
    request: Request<axum::body::Body>,
) -> Response {
    let Some(client) = state.bus_client.get() else {
        return AppError::Internal("share registry is not connected".into()).into_response();
    };
    let link = match share::resolve_public(client, share::photo_caller(None), &token, "photo_album").await {
        Ok(link) => link,
        Err(e) => return e.into_response(),
    };
    let Some(album_id) = link.resource_id else {
        return AppError::NotFound("share link has no album resource".into()).into_response();
    };
    let album = match PhotoRepo::get_album(&state.db, album_id).await {
        Ok(album) => album,
        Err(e) => return e.into_response(),
    };
    let photo_uuid = match parse_uuid(&photo_id) {
        Ok(id) => id,
        Err(e) => return e.into_response(),
    };
    let allowed = if album.album_type == "clip" {
        match album.source_ref.as_deref() {
            Some(query) => match PhotoClipService::search(&state.db, &state, album.app_id, query).await {
                Ok(results) => results.iter().any(|item| item.photo_id == photo_id),
                Err(e) => return e.into_response(),
            },
            None => false,
        }
    } else {
        match PhotoRepo::album_contains_photo(&state.db, &album, photo_uuid).await {
            Ok(allowed) => allowed,
            Err(e) => return e.into_response(),
        }
    };
    if !allowed {
        return AppError::Forbidden("photo is not in shared album".into()).into_response();
    }
    crate::handlers::stream::serve_photo_image(State(state), Path(photo_id), Query(q), request).await
}

fn clip_results_to_page(results: Vec<ClipSearchResult>, page: &PageInput) -> crate::db::pagination::Page<PhotoOutput> {
    let total = results.len() as i64;
    let start = ((page.page.saturating_sub(1)) * page.page_size) as usize;
    let end = start.saturating_add(page.page_size as usize).min(results.len());
    let items = results
        .into_iter()
        .skip(start)
        .take(end.saturating_sub(start))
        .filter_map(|item| {
            Some(PhotoOutput {
                id: item.photo_id.parse().ok()?,
                app_id: item.app_id.parse().ok()?,
                filename: item.filename,
                path: item.path,
                title: item.title,
                width: item.width,
                height: item.height,
                file_size: item.file_size,
                mime_type: item.mime_type,
                taken_at: item.taken_at.and_then(|s| chrono::DateTime::parse_from_rfc3339(&s).ok()),
                thumbnail_path: item.thumbnail_path,
                is_favorite: item.is_favorite,
                camera_make: None,
                camera_model: None,
                orientation: None,
                live_video_path: None,
                source_id: None,
            })
        })
        .collect();
    crate::db::pagination::Page::new(items, total, page)
}
