use axum::{
    Json,
    extract::{Path, Query, State},
};
use serde::Deserialize;
use std::sync::Arc;
use uuid::Uuid;

use crate::AppState;
use crate::apps::photo::repos::{ListPhotosInput, PhotoRepo};
use crate::db::pagination::PageInput;
use crate::error::AppError;
use crate::error::OptionExt;
use crate::handlers::{ApiResponse, ok};

use super::parse_uuid;

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

/// GET /api/apps/photo/{id}/photos
pub async fn list_photos(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(q): Query<ListPhotosQuery>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let uid = parse_uuid(&id)?;
    let page_input = PageInput {
        page: q.page.unwrap_or(1),
        page_size: q.page_size.unwrap_or(60),
    };
    let result = PhotoRepo::list(
        &state.db,
        ListPhotosInput {
            app_id: uid,
            page: page_input,
            sort_by: q.sort_by.clone().unwrap_or_else(|| "takenAt".to_string()),
            sort_dir: q.sort_dir.clone().unwrap_or_else(|| "desc".to_string()),
            search: q.search.clone(),
            favorites_only: q.favorites_only.unwrap_or(false),
            before_date: q.before_date.clone(),
            after_date: q.after_date.clone(),
        },
    )
    .await?;
    Ok(ok(serde_json::to_value(result)?))
}

/// GET /api/apps/photo/{id}/photos/timeline
pub async fn photo_timeline(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(q): Query<ListPhotosQuery>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let uid = parse_uuid(&id)?;
    let page_input = PageInput {
        page: q.page.unwrap_or(1),
        page_size: q.page_size.unwrap_or(100),
    };
    let result = PhotoRepo::timeline(&state.db, uid, &page_input).await?;
    Ok(ok(serde_json::to_value(result)?))
}

/// GET /api/apps/photo/{id}/photos/timeline-index
pub async fn timeline_index(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let uid = parse_uuid(&id)?;
    let entries = PhotoRepo::timeline_index(&state.db, uid).await?;
    Ok(ok(serde_json::to_value(entries).unwrap()))
}

/// GET /api/apps/photo/{photoId}
pub async fn get_photo(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let uid = parse_uuid(&id)?;
    let photo = PhotoRepo::get_by_id(&state.db, uid)
        .await?
        .not_found("Photo not found")?;
    Ok(ok(serde_json::to_value(photo).unwrap()))
}

#[derive(Debug, Deserialize)]
pub struct FoldersQuery {
    pub path: Option<String>,
}

/// GET /api/apps/photo/{id}/photos/folders
pub async fn list_folders(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(q): Query<FoldersQuery>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let uid = parse_uuid(&id)?;
    let dir_path = q.path.as_deref().unwrap_or("/");
    let (folders, photos) = PhotoRepo::list_folders(&state.db, uid, dir_path).await?;
    Ok(ok(serde_json::json!({
        "folders": folders,
        "photos": photos,
        "path": dir_path,
    })))
}

// ── Similar photos (CLIP vector) ──

#[derive(Debug, Deserialize)]
pub struct SimilarPhotosQuery {
    pub limit: Option<i32>,
}

#[derive(Debug, serde::Serialize, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SimilarPhotosResponse {
    pub indexed: bool,
    pub items: Vec<SimilarPhotoResult>,
}

#[derive(Debug, serde::Serialize, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SimilarPhotoResult {
    #[ts(type = "string")]
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
    #[ts(type = "number | null")]
    pub file_size: Option<i64>,
    pub mime_type: Option<String>,
}

/// GET /api/apps/photo/{photoId}/similar
pub async fn similar_photos(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(params): Query<SimilarPhotosQuery>,
) -> Result<Json<ApiResponse<SimilarPhotosResponse>>, AppError> {
    let photo_id = parse_uuid(&id)?;
    let limit = params.limit.unwrap_or(6).min(100);

    use sea_orm::{ConnectionTrait, DatabaseBackend, Statement};

    let photo = PhotoRepo::get_model_by_id(&state.db, photo_id)
        .await?
        .not_found("Photo not found")?;

    let app_id = photo.app_id;

    let vec_row = state
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
            return Ok(ok(SimilarPhotosResponse {
                indexed: false,
                items: vec![],
            }));
        }
    };

    let rows = state
        .db
        .query_all_raw(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r"SELECT p.id as photo_id, p.filename, p.thumbnail_path,
                      p.width, p.height, p.taken_at, p.is_favorite,
                      p.file_size, p.mime_type, p.path, p.title,
                      p.camera_make, p.camera_model, p.orientation,
                      p.live_video_path, p.source_id,
                      1 - (v.vec <=> $1::vector) as similarity
               FROM photo_clip_vectors v
               JOIN photos p ON p.id = v.photo_id
               WHERE p.app_id = $2 AND p.id != $3 AND p.deleted_at IS NULL
                 AND 1 - (v.vec <=> $1::vector) > 0.5
               ORDER BY v.vec <=> $1::vector
               LIMIT $4",
            [vec_str.into(), app_id.into(), photo_id.into(), i64::from(limit).into()],
        ))
        .await?;

    let mut results = Vec::new();
    for row in rows {
        results.push(SimilarPhotoResult {
            photo_id: row.try_get::<Uuid>("", "photo_id").unwrap_or_default(),
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
    Ok(ok(SimilarPhotosResponse {
        indexed: true,
        items: results,
    }))
}

// ── Photo tags (CLIP zero-shot classification) ──

#[derive(Debug, serde::Serialize, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PhotoTagsResponse {
    pub indexed: bool,
    pub tags: Vec<PhotoTag>,
}

#[derive(Debug, serde::Serialize, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PhotoTag {
    pub category: String,
    pub icon: String,
    pub subcategory: String,
    pub score: f64,
}

/// GET /api/apps/photo/{photoId}/tags
pub async fn photo_tags(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<PhotoTagsResponse>>, AppError> {
    let photo_id = parse_uuid(&id)?;

    use sea_orm::{ConnectionTrait, DatabaseBackend, Statement};

    let vec_row = state
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
            return Ok(ok(PhotoTagsResponse {
                indexed: false,
                tags: vec![],
            }));
        }
    };

    let vec_trimmed = vec_str.trim_start_matches('[').trim_end_matches(']');
    let image_vec: Vec<f32> = vec_trimmed
        .split(',')
        .map(|s| {
            s.trim()
                .parse::<f32>()
                .map_err(|e| AppError::Internal(format!("Parse vector element: {e}")))
        })
        .collect::<Result<_, _>>()?;

    let tag_results = state
        .ai
        .clip_classify(&image_vec)
        .await
        .map_err(|e| AppError::Internal(format!("CLIP classify: {e}")))?;

    let tags = tag_results
        .into_iter()
        .map(|t| PhotoTag {
            category: t.category.to_string(),
            icon: t.icon.to_string(),
            subcategory: t.subcategory.to_string(),
            score: f64::from(t.score),
        })
        .collect();

    Ok(ok(PhotoTagsResponse { indexed: true, tags }))
}
