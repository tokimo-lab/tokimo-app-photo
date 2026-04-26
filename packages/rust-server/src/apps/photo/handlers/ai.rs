use axum::{
    Json,
    extract::{Path, Query, State},
    response::IntoResponse,
};
use serde::Deserialize;
use std::sync::Arc;

use crate::AppState;
use crate::apps::photo::repos::{PhotoLibraryRepo, PhotoRepo};
use crate::error::{AppError, OptionExt};
use crate::handlers::user::AuthUser;
use crate::handlers::{ApiResponse, ok};

use super::parse_uuid;

// ── AI Settings ──

/// GET /api/settings/photo-ai
pub async fn get_photo_ai_settings(
    State(state): State<Arc<AppState>>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    use crate::config::PhotoAiSettings;
    use crate::db::repos::system_config_repo::SystemConfigRepo;
    let settings: PhotoAiSettings = SystemConfigRepo::get(&state.db).await?;
    Ok(ok(serde_json::to_value(settings).unwrap()))
}

/// PUT /api/settings/photo-ai
pub async fn update_photo_ai_settings(
    State(state): State<Arc<AppState>>,
    Json(body): Json<crate::config::PhotoAiSettings>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    use crate::db::repos::system_config_repo::SystemConfigRepo;
    SystemConfigRepo::set(&state.db, &body).await?;
    Ok(ok(serde_json::to_value(body).unwrap()))
}

/// POST /api/settings/photo-ai/test
pub async fn test_photo_ai_connection(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let mut results: Vec<serde_json::Value> = Vec::new();

    let models_ready = state.ai.models_ready();
    let ocr_ready = models_ready && state.ai.is_ocr_enabled();
    let clip_ready = models_ready && state.ai.is_clip_enabled();
    let face_ready = models_ready && state.ai.is_face_enabled();

    let detail = format!(
        "OCR: {}, CLIP: {}, Face: {}",
        if ocr_ready { "✓" } else { "✗" },
        if clip_ready { "✓" } else { "✗" },
        if face_ready { "✓" } else { "✗" },
    );

    results.push(serde_json::json!({
        "name": "aiService",
        "success": models_ready,
        "detail": if models_ready { detail } else { "Models not downloaded".to_string() },
        "modelsReady": models_ready,
    }));

    ok(serde_json::json!({ "results": results })).into_response()
}

// ── OCR ──

/// POST /api/apps/photo/{id}/photos/ocr-scan
pub async fn ocr_scan(
    State(state): State<Arc<AppState>>,
    AuthUser(auth): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let app_id = parse_uuid(&id)?;
    let user_id: uuid::Uuid = auth
        .user_id
        .parse()
        .map_err(|_| AppError::Unauthorized("invalid auth user id".into()))?;
    PhotoLibraryRepo::get_by_id(&state.db, app_id)
        .await?
        .not_found(format!("photo library {id} not found"))?;

    crate::apps::photo::services::preempt::preempt_scan_for(&state, app_id, "photo_ocr_scan").await?;

    crate::db::repos::job_repo::JobRepo::create_job(
        &state.db,
        "photo_ocr_scan",
        serde_json::json!({ "appId": app_id.to_string() }),
        None,
        Some(user_id),
    )
    .await?;
    Ok(ok(serde_json::json!({"status": "started"})))
}

#[derive(Debug, Deserialize)]
pub struct OcrSearchQuery {
    pub q: String,
}

/// GET /api/apps/photo/{id}/photos/ocr-search?q=text
pub async fn ocr_search(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(q): Query<OcrSearchQuery>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let app_id = parse_uuid(&id)?;
    let results = crate::apps::photo::services::ocr::PhotoOcrService::search_ocr_text(&state.db, app_id, &q.q).await?;
    Ok(ok(serde_json::to_value(results).unwrap()))
}

#[derive(Debug, Deserialize)]
pub struct ClearOcrQuery {
    pub model: Option<String>,
}

/// DELETE /api/apps/photo/{id}/photos/ocr-results
pub async fn clear_ocr_results(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(q): Query<ClearOcrQuery>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let app_id = parse_uuid(&id)?;
    let deleted = PhotoRepo::clear_ocr_results_for_app(&state.db, app_id, q.model.as_deref()).await?;
    Ok(ok(serde_json::json!({ "deletedCount": deleted })))
}

/// DELETE /api/apps/photo/{id}/photos/face-results
pub async fn clear_face_results(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let app_id = parse_uuid(&id)?;
    let deleted = PhotoRepo::clear_face_results_for_app(&state.db, app_id).await?;
    Ok(ok(serde_json::json!({ "deletedCount": deleted })))
}

/// DELETE /api/apps/photo/{id}/photos/clip-results
pub async fn clear_clip_results(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let app_id = parse_uuid(&id)?;
    let deleted = PhotoRepo::clear_clip_results_for_app(&state.db, app_id).await?;
    Ok(ok(serde_json::json!({ "deletedCount": deleted })))
}

/// DELETE /api/apps/photo/{id}/photos/thumbnails
pub async fn clear_thumbnails(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let app_id = parse_uuid(&id)?;
    let photo_ids = PhotoRepo::get_ids_for_app(&state.db, app_id).await?;

    if photo_ids.is_empty() {
        return Ok(ok(serde_json::json!({ "deletedCount": 0 })));
    }

    let widths = [64, 128, 160, 240, 320, 480, 640, 960, 1280, 1920];
    let mut deleted = 0u64;
    for pid in &photo_ids {
        for w in &widths {
            let key = format!("thumbs/photo/{pid}.{w}x0.webp");
            if state.storage.delete(&key).await.is_ok() {
                deleted += 1;
            }
        }
    }

    Ok(ok(serde_json::json!({ "deletedCount": deleted })))
}

/// DELETE /api/settings/photo-ai/ocr-results
pub async fn clear_all_ocr_results(
    State(state): State<Arc<AppState>>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let deleted = PhotoRepo::clear_all_ocr_results(&state.db).await?;
    Ok(ok(serde_json::json!({ "deleted": deleted })))
}

// ── CLIP ──

/// POST /api/apps/photo/{id}/photos/clip-embed
pub async fn clip_embed(
    State(state): State<Arc<AppState>>,
    AuthUser(auth): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let app_id = parse_uuid(&id)?;
    let user_id: uuid::Uuid = auth
        .user_id
        .parse()
        .map_err(|_| AppError::Unauthorized("invalid auth user id".into()))?;
    PhotoLibraryRepo::get_by_id(&state.db, app_id)
        .await?
        .not_found(format!("photo library {id} not found"))?;

    crate::apps::photo::services::preempt::preempt_scan_for(&state, app_id, "photo_clip_scan").await?;

    crate::db::repos::job_repo::JobRepo::create_job(
        &state.db,
        "photo_clip_scan",
        serde_json::json!({ "appId": app_id.to_string() }),
        None,
        Some(user_id),
    )
    .await?;
    Ok(ok(serde_json::json!({"status": "started"})))
}

#[derive(Debug, Deserialize)]
pub struct ClipSearchQuery {
    pub q: String,
}

/// GET /api/apps/photo/{id}/photos/clip-search?q=text
pub async fn clip_search(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(q): Query<ClipSearchQuery>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let app_id = parse_uuid(&id)?;
    let results = crate::apps::photo::services::clip::PhotoClipService::search(&state.db, &state, app_id, &q.q).await?;
    Ok(ok(serde_json::to_value(results).unwrap()))
}

/// POST /api/photos/{id}/refresh-clip
///
/// Enqueues a single-photo CLIP job (priority=UserAction, dedupe_key=photo_id)
/// and preempts any in-flight scan-child for the same photo. Returns the new
/// job id so the frontend can subscribe to its updates.
pub async fn refresh_clip(
    State(state): State<Arc<AppState>>,
    AuthUser(auth): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let photo_id = parse_uuid(&id)?;
    let user_id: uuid::Uuid = auth
        .user_id
        .parse()
        .map_err(|_| AppError::Unauthorized("invalid auth user id".into()))?;

    crate::apps::photo::services::preempt::preempt_scan_child_for_photo(&state, "photo_clip", photo_id).await?;

    let (job, _alias_target) = crate::db::repos::job_repo::JobRepo::enqueue_with_dedupe(
        &state.db,
        "photo_clip_single",
        serde_json::json!({ "photoId": photo_id.to_string() }),
        None,
        Some(user_id),
        None,
        Some("photo_clip_single".to_string()),
        Some(photo_id.to_string()),
        crate::queue::JobPriority::UserAction.as_i32(),
    )
    .await?;
    state.job_notify.notify_waiters();
    Ok(ok(
        serde_json::json!({ "jobId": job.id.to_string(), "status": job.status }),
    ))
}

/// POST /api/photos/{id}/refresh-faces
pub async fn refresh_faces(
    State(state): State<Arc<AppState>>,
    AuthUser(auth): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let photo_id = parse_uuid(&id)?;
    let user_id: uuid::Uuid = auth
        .user_id
        .parse()
        .map_err(|_| AppError::Unauthorized("invalid auth user id".into()))?;

    crate::apps::photo::services::preempt::preempt_scan_child_for_photo(&state, "photo_face", photo_id).await?;

    let (job, _alias_target) = crate::db::repos::job_repo::JobRepo::enqueue_with_dedupe(
        &state.db,
        "photo_face_single",
        serde_json::json!({ "photoId": photo_id.to_string() }),
        None,
        Some(user_id),
        None,
        Some("photo_face_single".to_string()),
        Some(photo_id.to_string()),
        crate::queue::JobPriority::UserAction.as_i32(),
    )
    .await?;
    state.job_notify.notify_waiters();
    Ok(ok(
        serde_json::json!({ "jobId": job.id.to_string(), "status": job.status }),
    ))
}

/// POST /api/photos/{id}/refresh-ocr
pub async fn refresh_ocr(
    State(state): State<Arc<AppState>>,
    AuthUser(auth): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let photo_id = parse_uuid(&id)?;
    let user_id: uuid::Uuid = auth
        .user_id
        .parse()
        .map_err(|_| AppError::Unauthorized("invalid auth user id".into()))?;

    crate::apps::photo::services::preempt::preempt_scan_child_for_photo(&state, "photo_ocr", photo_id).await?;

    let (job, _alias_target) = crate::db::repos::job_repo::JobRepo::enqueue_with_dedupe(
        &state.db,
        "photo_ocr_single",
        serde_json::json!({ "photoId": photo_id.to_string() }),
        None,
        Some(user_id),
        None,
        Some("photo_ocr_single".to_string()),
        Some(photo_id.to_string()),
        crate::queue::JobPriority::UserAction.as_i32(),
    )
    .await?;
    state.job_notify.notify_waiters();
    Ok(ok(
        serde_json::json!({ "jobId": job.id.to_string(), "status": job.status }),
    ))
}

/// GET /api/photos/{id}/ocr-results
pub async fn get_photo_ocr_results(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let photo_id = parse_uuid(&id)?;
    let rows = PhotoRepo::get_ocr_results(&state.db, photo_id).await?;

    let results: Vec<serde_json::Value> = rows
        .into_iter()
        .map(|r| {
            serde_json::json!({
                "id": r.id.to_string(),
                "text": r.text,
                "x": r.x,
                "y": r.y,
                "w": r.w,
                "h": r.h,
                "angle": r.angle,
                "score": r.score,
                "paragraphId": r.paragraph_id,
                "charPositions": r.char_positions,
                "modelName": r.model_name,
                "positioningType": r.positioning_type,
                "corners": r.corners,
            })
        })
        .collect();

    Ok(ok(serde_json::to_value(results).unwrap()))
}

// ── OCR CRUD ──

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateOcrResultInput {
    pub text: Option<String>,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub w: Option<f64>,
    pub h: Option<f64>,
    pub angle: Option<f64>,
    pub corners: Option<Vec<[f64; 2]>>,
}

/// PATCH /api/photos/ocr-results/{ocr_id}
pub async fn update_ocr_result(
    State(state): State<Arc<AppState>>,
    Path(ocr_id): Path<i32>,
    Json(input): Json<UpdateOcrResultInput>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let updated =
        crate::apps::photo::services::ocr::PhotoOcrService::update_ocr_result(&state.db, ocr_id, input).await?;

    Ok(ok(serde_json::json!({
        "id": updated.id.to_string(),
        "text": updated.text,
        "x": updated.x,
        "y": updated.y,
        "w": updated.w,
        "h": updated.h,
        "angle": updated.angle,
        "score": updated.score,
        "paragraphId": updated.paragraph_id,
        "charPositions": updated.char_positions,
        "modelName": updated.model_name,
        "positioningType": updated.positioning_type,
        "corners": updated.corners,
    })))
}

/// DELETE /api/photos/ocr-results/{ocr_id}
pub async fn delete_ocr_result(
    State(state): State<Arc<AppState>>,
    Path(ocr_id): Path<i32>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    crate::apps::photo::services::ocr::PhotoOcrService::delete_ocr_result(&state.db, ocr_id).await?;
    Ok(ok(serde_json::json!({ "deleted": true })))
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateOcrResultInput {
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub corners: Option<Vec<[f64; 2]>>,
}

/// POST /api/photos/{id}/ocr-results
pub async fn create_ocr_result(
    State(state): State<Arc<AppState>>,
    Path(photo_id): Path<String>,
    Json(input): Json<CreateOcrResultInput>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let photo_id = parse_uuid(&photo_id)?;
    let created =
        crate::apps::photo::services::ocr::PhotoOcrService::create_ocr_result(&state.db, photo_id, input).await?;

    Ok(ok(serde_json::json!({
        "id": created.id.to_string(),
        "text": created.text,
        "x": created.x,
        "y": created.y,
        "w": created.w,
        "h": created.h,
        "angle": created.angle,
        "score": created.score,
        "paragraphId": created.paragraph_id,
        "charPositions": created.char_positions,
        "modelName": created.model_name,
        "positioningType": created.positioning_type,
        "corners": created.corners,
    })))
}
