use axum::{
    Json,
    extract::{Path, Query, State},
    response::IntoResponse,
};
use serde::Deserialize;
use std::sync::Arc;

use crate::AppCtx;
use crate::db::repos::{PhotoLibraryRepo, PhotoRepo};
use crate::error::{AppError, OptionExt};
use crate::handlers::user::AuthUser;
use crate::services::clip::PhotoClipService;
use crate::services::geo::reverse_geocode_dispatch;
use crate::services::ocr::PhotoOcrService;
use crate::services::preempt;
use crate::services::geo::reverse_geocode_dispatch;

use super::parse_uuid;

// ── AI Settings ──

/// Enqueue a library-wide OCR scan, preempting any active OCR scan first.
pub async fn ocr_scan(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    auth: AuthUser,
) -> Result<Json<serde_json::Value>, AppError> {
    let caller_user_id: Uuid = auth
        .user_id
        .parse()
        .map_err(|_| AppError::Unauthorized("invalid user_id in auth token".into()))?;
    enqueue_library_scan(&ctx, &id, "photo_ocr_scan", caller_user_id).await
}

/// Enqueue a library-wide CLIP embedding scan.
pub async fn clip_embed(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    auth: AuthUser,
) -> Result<Json<serde_json::Value>, AppError> {
    let caller_user_id: Uuid = auth
        .user_id
        .parse()
        .map_err(|_| AppError::Unauthorized("invalid user_id in auth token".into()))?;
    enqueue_library_scan(&ctx, &id, "photo_clip_scan", caller_user_id).await
}

/// Enqueue a library-wide face detection scan.
pub async fn face_detect(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    auth: AuthUser,
) -> Result<Json<serde_json::Value>, AppError> {
    let caller_user_id: Uuid = auth
        .user_id
        .parse()
        .map_err(|_| AppError::Unauthorized("invalid user_id in auth token".into()))?;
    enqueue_library_scan(&ctx, &id, "photo_face_scan", caller_user_id).await
}

async fn enqueue_library_scan(
    ctx: &Arc<AppCtx>,
    id: &str,
    scan_job_type: &str,
    caller_user_id: Uuid,
) -> Result<Json<serde_json::Value>, AppError> {
    let app_id = parse_uuid(id)?;
    preempt::preempt_scan_for(ctx, app_id, scan_job_type, caller_user_id).await?;
    let req = CreateJobRequest::new(
        scan_job_type,
        serde_json::json!({ "photoLibraryId": app_id.to_string() }),
    );
    jobs::create(&ctx.client(), photo_caller(Some(caller_user_id)), req).await?;
    ok(serde_json::json!({ "status": "started" }))
}

// ── Per-photo refresh ────────────────────────────────────────────────────────

/// Refresh CLIP embedding for a single photo (user-priority).
pub async fn refresh_clip(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    auth: AuthUser,
) -> Result<Json<serde_json::Value>, AppError> {
    let caller_user_id: Uuid = auth
        .user_id
        .parse()
        .map_err(|_| AppError::Unauthorized("invalid user_id in auth token".into()))?;
    enqueue_photo_refresh(&ctx, &id, "photo_clip", "photo_clip_single", caller_user_id).await
}

/// Refresh face detection for a single photo (user-priority).
pub async fn refresh_faces(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    auth: AuthUser,
) -> Result<Json<serde_json::Value>, AppError> {
    let caller_user_id: Uuid = auth
        .user_id
        .parse()
        .map_err(|_| AppError::Unauthorized("invalid user_id in auth token".into()))?;
    enqueue_photo_refresh(&ctx, &id, "photo_face", "photo_face_single", caller_user_id).await
}

/// Refresh OCR for a single photo (user-priority).
pub async fn refresh_ocr(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    auth: AuthUser,
) -> Result<Json<serde_json::Value>, AppError> {
    let caller_user_id: Uuid = auth
        .user_id
        .parse()
        .map_err(|_| AppError::Unauthorized("invalid user_id in auth token".into()))?;
    enqueue_photo_refresh(&ctx, &id, "photo_ocr", "photo_ocr_single", caller_user_id).await
}

async fn enqueue_photo_refresh(
    ctx: &Arc<AppCtx>,
    id: &str,
    child_task_type: &str,
    single_job_type: &str,
    caller_user_id: Uuid,
) -> Result<Json<serde_json::Value>, AppError> {
    let photo_id = parse_uuid(id)?;
    preempt::preempt_scan_child_for_photo(ctx, child_task_type, photo_id, caller_user_id).await?;
    let mut req = CreateJobRequest::new(
        single_job_type,
        serde_json::json!({ "photoId": photo_id.to_string() }),
    );
    req.dedupe_key = Some(photo_id.to_string());
    // 1000 == host `JobPriority::UserAction` — user-initiated refreshes jump the queue.
    req.priority = Some(1000);
    req.task_type = Some(single_job_type.to_string());
    let job = jobs::create(&ctx.client(), photo_caller(Some(caller_user_id)), req).await?;
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
// These two remain stubbed because their backing infrastructure has not been
// ported into the sidecar yet:
//   • `clear_thumbnails` / `refresh_thumbnail` need a thumbnail storage layer
//     (the host's `state.storage.delete`), which is absent from `AppCtx`.
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

/// POST /api/photos/{id}/refresh-exif
///
/// Re-extract EXIF metadata + dimensions for a single photo.
pub async fn refresh_exif(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let photo_id = parse_uuid(&id)?;

    let photo = photos::Entity::find_by_id(photo_id)
        .one(&ctx.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Photo not found".into()))?;

    let source_id = photo
        .source_id
        .ok_or_else(|| AppError::BadRequest("Photo has no source".into()))?;

    let vfs = ctx.sources.ensure_vfs(&source_id.to_string()).await?;

    let fp = std::path::Path::new(&photo.path);
    let bytes = vfs
        .read_bytes(fp, 0, Some(256 * 1024))
        .await
        .map_err(|e| AppError::Internal(format!("read photo bytes: {e}")))?;

    // Extract EXIF
    let partial = bytes.clone();
    let exif_result = tokio::task::spawn_blocking(move || {
        tokimo_package_image::extract_exif_from_bytes(&partial)
    })
    .await
    .ok()
    .flatten();

    let mut got_dims = false;
    if let Some(ref exif) = exif_result {
        got_dims = exif.width.is_some() && exif.height.is_some();
        apply_exif_update(&ctx.db, photo_id, exif).await?;
    }

    // Fallback: read dimensions from image header if EXIF didn't provide them
    if !got_dims {
        let dim_bytes = bytes.clone();
        if let Ok(Some((w, h))) = tokio::task::spawn_blocking(move || {
            tokimo_package_image::get_image_dimensions_from_bytes(&dim_bytes)
        })
        .await
        {
            let now = chrono::Utc::now().fixed_offset();
            photos::ActiveModel {
                id: sea_orm::Set(photo_id),
                width: sea_orm::Set(Some(w)),
                height: sea_orm::Set(Some(h)),
                updated_at: sea_orm::Set(Some(now)),
                ..Default::default()
            }
            .update(&ctx.db)
            .await?;
        }
    }

    ok(serde_json::json!({ "status": "ok" }))
}

/// Apply extracted EXIF data to an existing photo record.
async fn apply_exif_update(
    db: &sea_orm::DatabaseConnection,
    photo_id: Uuid,
    exif: &tokimo_package_image::ExifData,
) -> Result<(), AppError> {
    use sea_orm::Set;
    let now = chrono::Utc::now().fixed_offset();
    let mut active = photos::ActiveModel {
        id: Set(photo_id),
        ..Default::default()
    };
    if let Some(w) = exif.width {
        active.width = Set(Some(w));
    }
    if let Some(h) = exif.height {
        active.height = Set(Some(h));
    }
    if let Some(ref raw) = exif.taken_at {
        let trimmed = raw.trim_matches('"');
        let normalized = trimmed.replacen(':', "-", 2);
        if let Ok(naive) = chrono::NaiveDateTime::parse_from_str(&normalized, "%Y-%m-%d %H:%M:%S") {
            active.taken_at = Set(Some(naive.and_utc().fixed_offset()));
        }
    }
    if let Some(ref v) = exif.camera_make {
        active.camera_make = Set(Some(v.clone()));
    }
    if let Some(ref v) = exif.camera_model {
        active.camera_model = Set(Some(v.clone()));
    }
    if let Some(ref v) = exif.lens_model {
        active.lens_model = Set(Some(v.clone()));
    }
    if let Some(v) = exif.focal_length {
        active.focal_length = Set(Some(v));
    }
    if let Some(v) = exif.aperture {
        active.aperture = Set(Some(v));
    }
    if let Some(ref v) = exif.shutter_speed {
        active.shutter_speed = Set(Some(v.clone()));
    }
    if let Some(v) = exif.iso {
        active.iso = Set(Some(v));
    }
    if let Some(v) = exif.orientation {
        active.orientation = Set(Some(v));
    }
    if let Some(v) = exif.gps_latitude {
        active.gps_latitude = Set(Some(v));
    }
    if let Some(v) = exif.gps_longitude {
        active.gps_longitude = Set(Some(v));
    }
    if let Some(v) = exif.gps_altitude {
        active.gps_altitude = Set(Some(v));
    }
    active.exif_data = Set(Some(
        serde_json::to_value(&exif.raw_tags).unwrap_or_default(),
    ));
    active.updated_at = Set(Some(now));
    active.update(db).await?;
    Ok(())
}

ai_stub!(refresh_thumbnail, path);

// ── Settings: photo-ai ───────────────────────────────────────────────────────

/// GET /settings/ai
pub async fn get_photo_ai_settings(
    State(state): State<Arc<AppCtx>>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    use crate::config::PhotoAiSettings;
    use crate::db::repos::system_config_repo::SystemConfigRepo;
    let settings: PhotoAiSettings = SystemConfigRepo::get(&state.db).await?;
    Ok(ok(serde_json::to_value(settings).unwrap()))
}

/// PUT /api/settings/photo-ai
pub async fn update_photo_ai_settings(
    State(state): State<Arc<AppCtx>>,
    Json(body): Json<crate::config::PhotoAiSettings>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    use crate::db::repos::system_config_repo::SystemConfigRepo;
    SystemConfigRepo::set(&state.db, &body).await?;
    Ok(ok(serde_json::to_value(body).unwrap()))
}

/// POST /api/settings/photo-ai/test
pub async fn test_photo_ai_connection(State(state): State<Arc<AppCtx>>) -> impl IntoResponse {
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
    State(state): State<Arc<AppCtx>>,
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

    crate::services::preempt::preempt_scan_for(&state, app_id, "photo_ocr_scan").await?;

    crate::db::repos::job_repo::JobRepo::create_job(
        &state.db,
        "photo_ocr_scan",
        serde_json::json!({ "photoLibraryId": app_id.to_string() }),
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
    State(state): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Query(q): Query<OcrSearchQuery>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let app_id = parse_uuid(&id)?;
    let results = crate::services::ocr::PhotoOcrService::search_ocr_text(&state.db, app_id, &q.q).await?;
    Ok(ok(serde_json::to_value(results).unwrap()))
}

#[derive(Debug, Deserialize)]
pub struct ClearOcrQuery {
    pub model: Option<String>,
}

/// DELETE /api/apps/photo/{id}/photos/ocr-results
pub async fn clear_ocr_results(
    State(state): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Query(q): Query<ClearOcrQuery>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let app_id = parse_uuid(&id)?;
    let deleted = PhotoRepo::clear_ocr_results_for_app(&state.db, app_id, q.model.as_deref()).await?;
    Ok(ok(serde_json::json!({ "deletedCount": deleted })))
}

    // Test 2: Map / browser key (provider-specific, optional)
    match settings.provider.as_str() {
        "amap" => {
            if let Some(js_key) = settings
                .amap_js_api_key
                .as_deref()
                .filter(|k| !k.is_empty())
            {
                let map_result = test_amap_js_key(&http, js_key).await;
                results.push(map_result);
            }
        }
        "tianditu" => {
            if let Some(bk) = settings
                .tianditu_browser_key
                .as_deref()
                .filter(|k| !k.is_empty())
            {
                let map_result = test_tianditu_browser_key(&http, bk).await;
                results.push(map_result);
            }
        }
        _ => {}
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
    State(state): State<Arc<AppCtx>>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let deleted = PhotoRepo::clear_all_ocr_results(&state.db).await?;
    Ok(ok(serde_json::json!({ "deleted": deleted })))
}

// ── CLIP ──

/// POST /api/apps/photo/{id}/photos/clip-embed
pub async fn clip_embed(
    State(state): State<Arc<AppCtx>>,
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

    crate::services::preempt::preempt_scan_for(&state, app_id, "photo_clip_scan").await?;

    crate::db::repos::job_repo::JobRepo::create_job(
        &state.db,
        "photo_clip_scan",
        serde_json::json!({ "photoLibraryId": app_id.to_string() }),
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
    State(state): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Query(q): Query<ClipSearchQuery>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let app_id = parse_uuid(&id)?;
    let results = crate::services::clip::PhotoClipService::search(&state.db, &state, app_id, &q.q).await?;
    Ok(ok(serde_json::to_value(results).unwrap()))
}

/// POST /api/photos/{id}/refresh-clip
///
/// Enqueues a single-photo CLIP job (priority=UserAction, dedupe_key=photo_id)
/// and preempts any in-flight scan-child for the same photo. Returns the new
/// job id so the frontend can subscribe to its updates.
pub async fn refresh_clip(
    State(state): State<Arc<AppCtx>>,
    AuthUser(auth): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let photo_id = parse_uuid(&id)?;
    let user_id: uuid::Uuid = auth
        .user_id
        .parse()
        .map_err(|_| AppError::Unauthorized("invalid auth user id".into()))?;

    crate::services::preempt::preempt_scan_child_for_photo(&state, "photo_clip", photo_id).await?;

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
    State(state): State<Arc<AppCtx>>,
    AuthUser(auth): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let photo_id = parse_uuid(&id)?;
    let user_id: uuid::Uuid = auth
        .user_id
        .parse()
        .map_err(|_| AppError::Unauthorized("invalid auth user id".into()))?;

    crate::services::preempt::preempt_scan_child_for_photo(&state, "photo_face", photo_id).await?;

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
    State(state): State<Arc<AppCtx>>,
    AuthUser(auth): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let photo_id = parse_uuid(&id)?;
    let user_id: uuid::Uuid = auth
        .user_id
        .parse()
        .map_err(|_| AppError::Unauthorized("invalid auth user id".into()))?;

    crate::services::preempt::preempt_scan_child_for_photo(&state, "photo_ocr", photo_id).await?;

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
    State(state): State<Arc<AppCtx>>,
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
    State(state): State<Arc<AppCtx>>,
    Path(ocr_id): Path<i32>,
    Json(input): Json<UpdateOcrResultInput>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let updated =
        crate::services::ocr::PhotoOcrService::update_ocr_result(&state.db, ocr_id, input).await?;

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
    State(state): State<Arc<AppCtx>>,
    Path(ocr_id): Path<i32>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    crate::services::ocr::PhotoOcrService::delete_ocr_result(&state.db, ocr_id).await?;
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
    State(state): State<Arc<AppCtx>>,
    Path(photo_id): Path<String>,
    Json(input): Json<CreateOcrResultInput>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let photo_id = parse_uuid(&photo_id)?;
    let created =
        crate::services::ocr::PhotoOcrService::create_ocr_result(&state.db, photo_id, input).await?;

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
