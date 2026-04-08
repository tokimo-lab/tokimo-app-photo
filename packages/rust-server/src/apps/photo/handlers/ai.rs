use axum::{
    extract::{Path, Query, State},
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use std::sync::Arc;

use crate::apps::photo::repos::PhotoRepo;
use crate::error::AppError;
use crate::handlers::{ok, ApiResponse};
use crate::AppState;

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
pub async fn test_photo_ai_connection(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
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

/// GET /api/settings/photo-ai/models-status
pub async fn ai_models_status(
    State(state): State<Arc<AppState>>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    Ok(ok(serde_json::json!({
        "modelsReady": state.ai.models_ready(),
        "ocrReady": state.ai.ocr_models_ready(),
        "ocrServerReady": state.ai.ocr_server_models_ready(),
        "ocrMobileReady": state.ai.ocr_mobile_models_ready(),
        "clipReady": state.ai.clip_models_ready(),
        "faceReady": state.ai.face_models_ready(),
        "modelsDir": state.ai.models_dir(),
    })))
}

#[derive(Deserialize)]
pub struct DownloadModelsQuery {
    pub category: Option<String>,
}

/// POST /api/settings/photo-ai/download-models?category=ocr
pub async fn download_ai_models(
    State(state): State<Arc<AppState>>,
    Query(query): Query<DownloadModelsQuery>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let category = match query.category.as_deref() {
        Some("ocr" | "ocr_server") => Some(rust_models::models::ModelCategory::OcrServer),
        Some("ocr_mobile") => Some(rust_models::models::ModelCategory::OcrMobile),
        Some("clip") => Some(rust_models::models::ModelCategory::Clip),
        Some("face") => Some(rust_models::models::ModelCategory::Face),
        Some(other) => {
            return Err(AppError::BadRequest(format!(
                "Unknown category: {other}. Use ocr_server, ocr_mobile, clip, or face."
            )));
        }
        None => None,
    };

    let cat_label = query.category.clone().unwrap_or_else(|| "all".to_string());
    let ai = state.ai.clone();
    let registry = Arc::clone(&state.vision_downloads);

    registry.clear().await;

    tokio::spawn(async move {
        let reg = Arc::clone(&registry);
        let progress_cb: rust_models::models::ProgressFn =
            Box::new(move |file, status, pct, downloaded, total| {
                let snap = crate::handlers::ws::VisionProgress {
                    file_name: file.to_string(),
                    status: status.to_string(),
                    progress: pct,
                    downloaded_bytes: downloaded,
                    total_bytes: total,
                    error: None,
                };
                let reg = Arc::clone(&reg);
                tokio::spawn(async move {
                    reg.update_and_broadcast(&snap).await;
                });
            });

        let result = if let Some(cat) = category {
            ai.ensure_category_with_progress(cat, progress_cb).await
        } else {
            ai.ensure_models_with_progress(progress_cb).await
        };

        let done_label = format!("_{cat_label}");
        match result {
            Ok(()) => {
                tracing::info!("AI models ({cat_label}) downloaded successfully");
                let snap = crate::handlers::ws::VisionProgress {
                    file_name: done_label,
                    status: "completed".to_string(),
                    progress: 100,
                    downloaded_bytes: 0,
                    total_bytes: 0,
                    error: None,
                };
                registry.update_and_broadcast(&snap).await;
            }
            Err(e) => {
                tracing::error!("AI model download ({cat_label}) failed: {e}");
                let snap = crate::handlers::ws::VisionProgress {
                    file_name: done_label,
                    status: "failed".to_string(),
                    progress: 0,
                    downloaded_bytes: 0,
                    total_bytes: 0,
                    error: Some(e),
                };
                registry.update_and_broadcast(&snap).await;
            }
        }
    });
    Ok(ok(serde_json::json!({"status": "downloading"})))
}

// ── OCR ──

/// POST /api/apps/photo/{id}/photos/ocr-scan
pub async fn ocr_scan(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let app_id = parse_uuid(&id)?;
    let db = state.db.clone();
    let st = state.clone();

    tokio::spawn(async move {
        match crate::apps::photo::services::ocr::PhotoOcrService::ocr_app(&db, &st, app_id).await {
            Ok(count) => tracing::info!("OCR scanned {count} photos for app {app_id}"),
            Err(e) => tracing::error!("OCR scan failed for app {app_id}: {e}"),
        }
    });

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
    let results =
        crate::apps::photo::services::ocr::PhotoOcrService::search_ocr_text(&state.db, app_id, &q.q)
            .await?;
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
    let deleted = PhotoRepo::clear_ocr_results_for_app(
        &state.db,
        app_id,
        q.model.as_deref(),
    )
    .await?;
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

/// GET /api/settings/photo-ai/sidecar-models
pub async fn get_sidecar_models(
    State(state): State<Arc<AppState>>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let url = match state.ai.config().ocr_sidecar_url.as_deref() {
        Some(u) if !u.is_empty() => u.to_string(),
        _ => return Ok(ok(serde_json::json!([]))),
    };

    let Ok(resp) = state
        .http_client
        .get(format!("{}/models", url.trim_end_matches('/')))
        .send()
        .await
    else {
        return Ok(ok(serde_json::json!([])));
    };

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::BadRequest(format!("Invalid sidecar response: {e}")))?;

    Ok(ok(body))
}

/// POST /api/settings/photo-ai/sidecar-models/{model_id}/load
pub async fn load_sidecar_model(
    State(state): State<Arc<AppState>>,
    Path(model_id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let url = state
        .ai
        .config()
        .ocr_sidecar_url
        .as_deref()
        .filter(|u| !u.is_empty())
        .ok_or_else(|| {
            AppError::BadRequest(
                "OCR sidecar 未配置。请在 AI 模型设置中配置 OCR_SIDECAR_URL 后重试。".to_string(),
            )
        })?;

    let resp = state
        .http_client
        .post(format!(
            "{}/models/{}/load",
            url.trim_end_matches('/'),
            model_id
        ))
        .timeout(std::time::Duration::from_secs(600))
        .send()
        .await
        .map_err(|e| AppError::BadRequest(format!("Cannot reach sidecar: {e}")))?;

    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::BadRequest(format!(
            "Sidecar model load failed: {text}"
        )));
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::BadRequest(format!("Invalid sidecar response: {e}")))?;

    Ok(ok(body))
}

// ── CLIP ──

/// POST /api/apps/photo/{id}/photos/clip-embed
pub async fn clip_embed(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let app_id = parse_uuid(&id)?;
    let db = state.db.clone();
    let st = state.clone();

    tokio::spawn(async move {
        match crate::apps::photo::services::clip::PhotoClipService::embed_app(&db, &st, app_id, None)
            .await
        {
            Ok(count) => tracing::info!("CLIP embedded {count} photos for app {app_id}"),
            Err(e) => tracing::error!("CLIP embed failed for app {app_id}: {e}"),
        }
    });

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
    let results =
        crate::apps::photo::services::clip::PhotoClipService::search(&state.db, &state, app_id, &q.q)
            .await?;
    Ok(ok(serde_json::to_value(results).unwrap()))
}

/// POST /api/photos/{id}/refresh-clip
pub async fn refresh_clip(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let photo_id = parse_uuid(&id)?;
    crate::apps::photo::services::clip::PhotoClipService::embed_photo(
        &state.db,
        &state,
        photo_id,
    )
    .await?;
    Ok(ok(serde_json::json!({ "status": "ok" })))
}

/// POST /api/photos/{id}/refresh-faces
pub async fn refresh_faces(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let photo_id = parse_uuid(&id)?;
    let count = crate::apps::photo::services::face::PhotoFaceService::detect_faces(
        &state.db,
        &state.ai,
        &state.sources,
        photo_id,
    )
    .await?;
    Ok(ok(serde_json::json!({ "faceCount": count })))
}

/// POST /api/photos/{id}/refresh-ocr
pub async fn refresh_ocr(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let photo_id = parse_uuid(&id)?;
    let count = crate::apps::photo::services::ocr::PhotoOcrService::ocr_photo(
        &state.db,
        &state,
        photo_id,
    )
    .await?;
    Ok(ok(serde_json::json!({ "ocrCount": count })))
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
    let updated = crate::apps::photo::services::ocr::PhotoOcrService::update_ocr_result(
        &state.db, ocr_id, input,
    )
    .await?;

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
    let created = crate::apps::photo::services::ocr::PhotoOcrService::create_ocr_result(
        &state.db, photo_id, input,
    )
    .await?;

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
