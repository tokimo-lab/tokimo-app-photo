//! Handlers for photo browsing — timeline, list, folders, get, similar, tags.

use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, Query, State},
};
use serde::Deserialize;
use uuid::Uuid;

use crate::ctx::AppCtx;
use crate::db::pagination::PageInput;
use crate::db::repos::photo_repo::{ListPhotosInput, PhotoRepo};
use crate::error::{AppError, OptionExt};

use super::{ok, parse_uuid};

// ── List photos ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListPhotosQuery {
    pub page: Option<u64>,
    pub page_size: Option<u64>,
    pub sort_by: Option<String>,
    pub sort_dir: Option<String>,
    pub search: Option<String>,
    pub favorites_only: Option<bool>,
    pub before_date: Option<String>,
    pub after_date: Option<String>,
}

pub async fn list_photos(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Query(q): Query<ListPhotosQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let uid = parse_uuid(&id)?;
    let page_input = PageInput {
        page: q.page.unwrap_or(1),
        page_size: q.page_size.unwrap_or(60),
    };
    let result = PhotoRepo::list(
        &ctx.db,
        ListPhotosInput {
            app_id: uid,
            page: page_input,
            sort_by: q.sort_by.unwrap_or_else(|| "takenAt".to_string()),
            sort_dir: q.sort_dir.unwrap_or_else(|| "desc".to_string()),
            search: q.search,
            favorites_only: q.favorites_only.unwrap_or(false),
            before_date: q.before_date,
            after_date: q.after_date,
        },
    )
    .await?;
    ok(result)
}

pub async fn photo_timeline(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Query(q): Query<ListPhotosQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let uid = parse_uuid(&id)?;
    let page_input = PageInput {
        page: q.page.unwrap_or(1),
        page_size: q.page_size.unwrap_or(100),
    };
    let result = PhotoRepo::timeline(&ctx.db, uid, &page_input).await?;
    ok(result)
}

pub async fn timeline_index(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let uid = parse_uuid(&id)?;
    let entries = PhotoRepo::timeline_index(&ctx.db, uid).await?;
    ok(entries)
}

pub async fn get_photo(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let uid = parse_uuid(&id)?;
    let photo = PhotoRepo::get_by_id(&ctx.db, uid)
        .await?
        .not_found("Photo not found")?;
    ok(photo)
}

// ── Folders ──────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct FoldersQuery {
    pub path: Option<String>,
}

pub async fn list_folders(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Query(q): Query<FoldersQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let uid = parse_uuid(&id)?;
    let dir_path = q.path.as_deref().unwrap_or("/");
    let (folders, photos) = PhotoRepo::list_folders(&ctx.db, uid, dir_path).await?;
    ok(serde_json::json!({
        "folders": folders,
        "photos": photos,
        "path": dir_path,
    }))
}

// ── Update photo ──────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePhotoInput {
    pub title: Option<Option<String>>,
    pub description: Option<Option<String>>,
    pub taken_at: Option<Option<chrono::DateTime<chrono::FixedOffset>>>,
}

pub async fn update_photo(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Json(body): Json<UpdatePhotoInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    let uid = parse_uuid(&id)?;
    let updated =
        PhotoRepo::update_photo(&ctx.db, uid, body.title, body.description, body.taken_at).await?;
    ok(updated)
}

pub async fn toggle_favorite(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let uid = parse_uuid(&id)?;
    let new_val = PhotoRepo::toggle_favorite(&ctx.db, uid).await?;
    ok(serde_json::json!({ "isFavorite": new_val }))
}

pub async fn toggle_hidden(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let uid = parse_uuid(&id)?;
    let new_val = PhotoRepo::toggle_hidden(&ctx.db, uid).await?;
    ok(serde_json::json!({ "isHidden": new_val }))
}

// ── Similar photos (CLIP) ─────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct SimilarPhotosQuery {
    pub limit: Option<i32>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimilarPhotosResponse {
    pub indexed: bool,
    pub items: Vec<SimilarPhotoResult>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimilarPhotoResult {
    pub photo_id: Uuid,
    pub filename: String,
    pub thumbnail_path: Option<String>,
    pub similarity: f64,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub taken_at: Option<String>,
    pub is_favorite: bool,
    pub app_id: String,
    pub path: String,
    pub title: Option<String>,
    pub file_size: Option<i64>,
    pub mime_type: Option<String>,
}

pub async fn similar_photos(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Query(params): Query<SimilarPhotosQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    use sea_orm::{ConnectionTrait, DatabaseBackend, Statement};

    let photo_id = parse_uuid(&id)?;
    let limit = params.limit.unwrap_or(6).min(100);

    let photo = PhotoRepo::get_model_by_id(&ctx.db, photo_id)
        .await?
        .not_found("Photo not found")?;
    let app_id = photo.app_id;

    let vec_row = ctx
        .db
        .query_one_raw(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT vec::text FROM photo_clip_vectors WHERE photo_id = $1",
            [photo_id.into()],
        ))
        .await?;

    let vec_str = match vec_row {
        Some(row) => row
            .try_get::<String>("", "vec")
            .map_err(|e| AppError::Internal(format!("Failed to read CLIP vector: {e}")))?,
        None => {
            return ok(SimilarPhotosResponse {
                indexed: false,
                items: vec![],
            });
        }
    };

    let rows = ctx
        .db
        .query_all_raw(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r"SELECT p.id as photo_id, p.filename, p.thumbnail_path,
                      p.width, p.height, p.taken_at, p.is_favorite,
                      p.file_size, p.mime_type, p.path, p.title,
                      1 - (v.vec <=> $1::vector) as similarity
               FROM photo_clip_vectors v
               JOIN photos p ON p.id = v.photo_id
               WHERE p.app_id = $2 AND p.id != $3 AND p.deleted_at IS NULL
                 AND 1 - (v.vec <=> $1::vector) > 0.5
               ORDER BY v.vec <=> $1::vector
               LIMIT $4",
            [
                vec_str.into(),
                app_id.into(),
                photo_id.into(),
                i64::from(limit).into(),
            ],
        ))
        .await?;

    let mut results = Vec::new();
    for row in rows {
        results.push(SimilarPhotoResult {
            photo_id: row.try_get::<Uuid>("", "photo_id").unwrap_or(Uuid::nil()),
            filename: row.try_get::<String>("", "filename").unwrap_or_default(),
            thumbnail_path: row.try_get("", "thumbnail_path").ok(),
            similarity: row.try_get::<f64>("", "similarity").unwrap_or(0.0),
            width: row.try_get("", "width").ok(),
            height: row.try_get("", "height").ok(),
            taken_at: row
                .try_get::<Option<chrono::DateTime<chrono::FixedOffset>>>("", "taken_at")
                .ok()
                .flatten()
                .map(|dt| dt.to_rfc3339()),
            is_favorite: row.try_get::<bool>("", "is_favorite").unwrap_or(false),
            app_id: app_id.to_string(),
            path: row.try_get("", "path").unwrap_or_default(),
            title: row.try_get("", "title").ok(),
            file_size: row.try_get("", "file_size").ok(),
            mime_type: row.try_get("", "mime_type").ok(),
        });
    }
    ok(SimilarPhotosResponse {
        indexed: true,
        items: results,
    })
}

/// GET /api/apps/photo/{photoId}/tags — AI-powered CLIP zero-shot classification.
/// Stubs out to empty since perception worker is not linked in this sidecar.
pub async fn photo_tags(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    use sea_orm::{ConnectionTrait, DatabaseBackend, Statement};
    let photo_id = parse_uuid(&id)?;

    let indexed = ctx
        .db
        .query_one_raw(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT 1 FROM photo_clip_vectors WHERE photo_id = $1",
            [photo_id.into()],
        ))
        .await?
        .is_some();

    ok(serde_json::json!({ "indexed": indexed, "tags": [] }))
}
