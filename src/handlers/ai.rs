//! AI handler — OCR / CLIP / face scan triggers, per-photo refresh actions,
//! OCR / CLIP search, result-clearing, OCR CRUD, and AI / geo settings.
//!
//! Scan + refresh endpoints enqueue jobs over the bus (`jobs.create`) using the
//! sidecar convention: there is no auth/user context, so every job is enqueued
//! with `photo_caller(None)` and no `user_id`.
//!
//! Three endpoints remain documented stubs (`clear_thumbnails`,
//! `refresh_thumbnail`, `refresh_exif`) — see the comment above them.

use std::sync::Arc;

use axum::{Json, extract::{Path, Query, State}};

use crate::bus_clients::jobs::{self, CreateJobRequest, photo_caller};
use crate::config::{PhotoAiSettings, PhotoGeoSettings};
use crate::ctx::AppCtx;
use crate::db::repos::app_settings_repo::AppSettingsRepo;
use crate::db::repos::photo_repo::PhotoRepo;
use crate::error::AppError;
use crate::services::clip::PhotoClipService;
use crate::services::ocr::PhotoOcrService;
use crate::services::preempt;

use super::{ok, ok_simple, parse_uuid};

// ── Library-scoped scan triggers ─────────────────────────────────────────────

/// Enqueue a library-wide OCR scan, preempting any active OCR scan first.
pub async fn ocr_scan(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    enqueue_library_scan(&ctx, &id, "photo_ocr_scan").await
}

/// Enqueue a library-wide CLIP embedding scan.
pub async fn clip_embed(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    enqueue_library_scan(&ctx, &id, "photo_clip_scan").await
}

/// Enqueue a library-wide face detection scan.
pub async fn face_detect(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    enqueue_library_scan(&ctx, &id, "photo_face_scan").await
}

async fn enqueue_library_scan(
    ctx: &Arc<AppCtx>,
    id: &str,
    scan_job_type: &str,
) -> Result<Json<serde_json::Value>, AppError> {
    let app_id = parse_uuid(id)?;
    preempt::preempt_scan_for(ctx, app_id, scan_job_type).await?;
    let req = CreateJobRequest::new(
        scan_job_type,
        serde_json::json!({ "photoLibraryId": app_id.to_string() }),
    );
    jobs::create(&ctx.client(), photo_caller(None), req).await?;
    ok(serde_json::json!({ "status": "started" }))
}

// ── Per-photo refresh ────────────────────────────────────────────────────────

/// Refresh CLIP embedding for a single photo (user-priority).
pub async fn refresh_clip(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    enqueue_photo_refresh(&ctx, &id, "photo_clip", "photo_clip_single").await
}

/// Refresh face detection for a single photo (user-priority).
pub async fn refresh_faces(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    enqueue_photo_refresh(&ctx, &id, "photo_face", "photo_face_single").await
}

/// Refresh OCR for a single photo (user-priority).
pub async fn refresh_ocr(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    enqueue_photo_refresh(&ctx, &id, "photo_ocr", "photo_ocr_single").await
}

async fn enqueue_photo_refresh(
    ctx: &Arc<AppCtx>,
    id: &str,
    child_task_type: &str,
    single_job_type: &str,
) -> Result<Json<serde_json::Value>, AppError> {
    let photo_id = parse_uuid(id)?;
    preempt::preempt_scan_child_for_photo(ctx, child_task_type, photo_id).await?;
    let mut req = CreateJobRequest::new(
        single_job_type,
        serde_json::json!({ "photoId": photo_id.to_string() }),
    );
    req.dedupe_key = Some(photo_id.to_string());
    // 1000 == host `JobPriority::UserAction` — user-initiated refreshes jump the queue.
    req.priority = Some(1000);
    req.task_type = Some(single_job_type.to_string());
    let job = jobs::create(&ctx.client(), photo_caller(None), req).await?;
    ok(serde_json::json!({ "jobId": job.id.to_string(), "status": job.status }))
}

// ── Search ───────────────────────────────────────────────────────────────────

#[derive(Debug, serde::Deserialize)]
pub struct OcrSearchQuery {
    pub q: String,
}

#[derive(Debug, serde::Deserialize)]
pub struct ClipSearchQuery {
    pub q: String,
}

/// GET /{id}/ocr-search?q= — full-text OCR search within a library.
pub async fn ocr_search(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Query(q): Query<OcrSearchQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let app_id = parse_uuid(&id)?;
    let results = PhotoOcrService::search_ocr_text(&ctx.db, app_id, &q.q).await?;
    let value = serde_json::to_value(results)
        .map_err(|e| AppError::Internal(format!("ocr_search serialize: {e}")))?;
    ok(value)
}

/// GET /{id}/clip-search?q= — semantic CLIP search within a library.
pub async fn clip_search(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Query(q): Query<ClipSearchQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let app_id = parse_uuid(&id)?;
    let results = PhotoClipService::search(&ctx.db, &ctx.ai, app_id, &q.q).await?;
    let value = serde_json::to_value(results)
        .map_err(|e| AppError::Internal(format!("clip_search serialize: {e}")))?;
    ok(value)
}

// ── Clear results ────────────────────────────────────────────────────────────

#[derive(Debug, serde::Deserialize)]
pub struct ClearOcrQuery {
    pub model: Option<String>,
}

/// DELETE /{id}/ocr-results — clear OCR results for a library (optional model filter).
pub async fn clear_ocr_results(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Query(q): Query<ClearOcrQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let app_id = parse_uuid(&id)?;
    let deleted = PhotoRepo::clear_ocr_results_for_app(&ctx.db, app_id, q.model.as_deref()).await?;
    ok(serde_json::json!({ "deletedCount": deleted }))
}

/// DELETE /{id}/face-results — clear face results for a library.
pub async fn clear_face_results(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let app_id = parse_uuid(&id)?;
    let deleted = PhotoRepo::clear_face_results_for_app(&ctx.db, app_id).await?;
    ok(serde_json::json!({ "deletedCount": deleted }))
}

/// DELETE /{id}/clip-results — clear CLIP vectors for a library.
pub async fn clear_clip_results(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let app_id = parse_uuid(&id)?;
    let deleted = PhotoRepo::clear_clip_results_for_app(&ctx.db, app_id).await?;
    ok(serde_json::json!({ "deletedCount": deleted }))
}

// ── Stubs pending infrastructure port ────────────────────────────────────────
//
// These three remain stubbed because their backing infrastructure has not been
// ported into the sidecar yet:
//   • `clear_thumbnails` / `refresh_thumbnail` need a thumbnail storage layer
//     (the host's `state.storage.delete`), which is absent from `AppCtx`.
//   • `refresh_exif` needs the `rescan_local_photo` / `rescan_remote_photo`
//     EXIF-rescan helpers, and the sidecar's `batch.rs::rescan` is itself still
//     a stub.
// They will be implemented alongside that infrastructure port.

macro_rules! ai_stub {
    ($name:ident, path) => {
        pub async fn $name(
            State(_ctx): State<Arc<AppCtx>>,
            Path(_id): Path<String>,
        ) -> Result<Json<serde_json::Value>, AppError> {
            tracing::warn!("photo AI not available in sidecar: {}", stringify!($name));
            ok_simple()
        }
    };
}

ai_stub!(clear_thumbnails, path);
ai_stub!(refresh_exif, path);
ai_stub!(refresh_thumbnail, path);

// ── Settings: photo-ai ───────────────────────────────────────────────────────

/// GET /settings/ai
pub async fn get_photo_ai_settings(
    State(ctx): State<Arc<AppCtx>>,
) -> Result<Json<serde_json::Value>, AppError> {
    let settings: PhotoAiSettings = AppSettingsRepo::get(&ctx.db).await?;
    ok(settings)
}

/// PUT /settings/ai
pub async fn update_photo_ai_settings(
    State(ctx): State<Arc<AppCtx>>,
    Json(body): Json<PhotoAiSettings>,
) -> Result<Json<serde_json::Value>, AppError> {
    AppSettingsRepo::set(&ctx.db, &body).await?;
    ok(body)
}

/// POST /settings/ai/test
///
/// Reports whether the perception worker has loaded the required models.
/// Faithful port of the presplit `test_photo_ai_connection`: reads live model
/// readiness from the linked [`AiWorkerClient`].
pub async fn test_photo_ai_connection(
    State(ctx): State<Arc<AppCtx>>,
) -> Result<Json<serde_json::Value>, AppError> {
    let models_ready = ctx.ai.models_ready();
    let ocr_ready = models_ready && ctx.ai.is_ocr_enabled();
    let clip_ready = models_ready && ctx.ai.is_clip_enabled();
    let face_ready = models_ready && ctx.ai.is_face_enabled();

    let detail = format!(
        "OCR: {}, CLIP: {}, Face: {}",
        if ocr_ready { "✓" } else { "✗" },
        if clip_ready { "✓" } else { "✗" },
        if face_ready { "✓" } else { "✗" },
    );

    let results = serde_json::json!([{
        "name": "aiService",
        "success": models_ready,
        "detail": if models_ready { detail } else { "Models not downloaded".to_string() },
        "modelsReady": models_ready,
    }]);
    ok(serde_json::json!({ "results": results }))
}

// ── Settings: photo-geo ──────────────────────────────────────────────────────

/// GET /settings/geo
pub async fn get_photo_geo_settings(
    State(ctx): State<Arc<AppCtx>>,
) -> Result<Json<serde_json::Value>, AppError> {
    let settings: PhotoGeoSettings = AppSettingsRepo::get(&ctx.db).await?;
    ok(settings)
}

/// PUT /settings/geo
pub async fn update_photo_geo_settings(
    State(ctx): State<Arc<AppCtx>>,
    Json(body): Json<PhotoGeoSettings>,
) -> Result<Json<serde_json::Value>, AppError> {
    AppSettingsRepo::set(&ctx.db, &body).await?;
    ok(body)
}

/// POST /settings/geo/test
///
/// Until the geo service is ported (see status report), this returns a stub
/// result so the UI's settings page doesn't break.
pub async fn test_photo_geo_connection(
    State(ctx): State<Arc<AppCtx>>,
) -> Result<Json<serde_json::Value>, AppError> {
    let settings: PhotoGeoSettings = AppSettingsRepo::get(&ctx.db).await?;
    let result = serde_json::json!({
        "success": false,
        "provider": settings.provider,
        "detail": "geo service not yet ported in sidecar",
    });
    ok(result)
}

/// Clear all OCR results across all photos (library-level).
pub async fn clear_all_ocr_results(
    State(ctx): State<Arc<AppCtx>>,
) -> Result<Json<serde_json::Value>, AppError> {
    PhotoRepo::clear_all_ocr_results(&ctx.db).await?;
    ok_simple()
}

/// GET /api/apps/photo/{photoId}/faces — list faces on a photo.
pub async fn get_photo_faces(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let uid = parse_uuid(&id)?;
    let faces = PhotoRepo::get_faces_for_photo(&ctx.db, uid).await?;
    ok(faces)
}

/// POST /api/apps/photo/{photoId}/faces/{faceId}/assign-person
pub async fn assign_face_to_person(
    State(ctx): State<Arc<AppCtx>>,
    Path((photo_id, face_id)): Path<(String, String)>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, AppError> {
    let face_id_int: i32 = face_id
        .parse()
        .map_err(|_| AppError::BadRequest(format!("invalid face id: {face_id}")))?;
    let person_id_str = body
        .get("personId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::BadRequest("missing personId".into()))?;
    let person_uid = parse_uuid(person_id_str)?;
    let _ = parse_uuid(&photo_id)?; // validate
    PhotoRepo::assign_face_to_person(&ctx.db, face_id_int, person_uid).await?;
    ok_simple()
}

/// POST /api/apps/photo/{photoId}/faces/{faceId}/create-person
pub async fn create_person_from_face(
    State(ctx): State<Arc<AppCtx>>,
    Path((photo_id, face_id)): Path<(String, String)>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, AppError> {
    let face_id_int: i32 = face_id
        .parse()
        .map_err(|_| AppError::BadRequest(format!("invalid face id: {face_id}")))?;
    let _ = parse_uuid(&photo_id)?;
    let name = body
        .get("name")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::BadRequest("missing name".into()))?;
    let person = PhotoRepo::create_person_from_face(&ctx.db, face_id_int, name).await?;
    ok(person)
}

/// GET /api/apps/photo/{photoId}/ocr
pub async fn get_photo_ocr_results(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let uid = parse_uuid(&id)?;
    let results = PhotoRepo::get_ocr_results(&ctx.db, uid).await?;
    ok(results)
}

// ── OCR CRUD inputs ──────────────────────────────────────────────────────────

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

/// POST /item/{id}/ocr-results — manually create an OCR result for a photo.
pub async fn create_ocr_result(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Json(input): Json<CreateOcrResultInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    let photo_id = parse_uuid(&id)?;
    let m = PhotoOcrService::create_ocr_result(&ctx.db, photo_id, input).await?;
    ok(serde_json::json!({
        "id": m.id.to_string(),
        "text": m.text,
        "x": m.x, "y": m.y, "w": m.w, "h": m.h,
        "angle": m.angle, "score": m.score,
        "paragraphId": m.paragraph_id,
        "charPositions": m.char_positions,
        "modelName": m.model_name,
        "positioningType": m.positioning_type,
        "corners": m.corners,
    }))
}

/// PATCH /ocr-results/{ocrId} — update an existing OCR result.
pub async fn update_ocr_result(
    State(ctx): State<Arc<AppCtx>>,
    Path(ocr_id): Path<i32>,
    Json(input): Json<UpdateOcrResultInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    let m = PhotoOcrService::update_ocr_result(&ctx.db, ocr_id, input).await?;
    ok(serde_json::json!({
        "id": m.id.to_string(),
        "text": m.text,
        "x": m.x, "y": m.y, "w": m.w, "h": m.h,
        "angle": m.angle, "score": m.score,
        "paragraphId": m.paragraph_id,
        "charPositions": m.char_positions,
        "modelName": m.model_name,
        "positioningType": m.positioning_type,
        "corners": m.corners,
    }))
}

/// DELETE /ocr-results/{ocrId} — delete a single OCR result.
pub async fn delete_ocr_result(
    State(ctx): State<Arc<AppCtx>>,
    Path(ocr_id): Path<i32>,
) -> Result<Json<serde_json::Value>, AppError> {
    PhotoRepo::delete_ocr_result(&ctx.db, ocr_id).await?;
    ok(serde_json::json!({ "deleted": true }))
}
