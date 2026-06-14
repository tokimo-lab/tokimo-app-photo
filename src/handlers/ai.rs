//! AI handler — OCR / CLIP / face scan triggers, per-photo refresh actions,
//! OCR / CLIP search, result-clearing, OCR CRUD, and AI / geo settings.
//!
//! Scan + refresh endpoints enqueue jobs over the bus (`jobs.create`) using the
//! authenticated request user as the caller context.
//!
//! Two endpoints remain documented stubs (`clear_thumbnails`,
//! `refresh_thumbnail`) — see the comment above them.

use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, Query, State},
};
use sea_orm::{ActiveModelTrait, EntityTrait};
use uuid::Uuid;

use crate::bus_clients::jobs::{self, CreateJobRequest, photo_caller};
use crate::config::{PhotoAiSettings, PhotoGeoSettings};
use crate::ctx::AppCtx;
use crate::db::entities::photos;
use crate::db::repos::app_settings_repo::AppSettingsRepo;
use crate::db::repos::photo_repo::PhotoRepo;
use crate::error::AppError;
use crate::handlers::user::AuthUser;
use crate::services::clip::PhotoClipService;
use crate::services::geo::reverse_geocode_dispatch;
use crate::services::ocr::PhotoOcrService;
use crate::services::preempt;

use super::{ok, ok_simple, parse_uuid};

// ── Library-scoped scan triggers ─────────────────────────────────────────────

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

/// POST /settings/geo/test — test all configured keys for the current provider
pub async fn test_photo_geo_connection(
    State(ctx): State<Arc<AppCtx>>,
) -> Result<Json<serde_json::Value>, AppError> {
    let settings: PhotoGeoSettings = AppSettingsRepo::get(&ctx.db).await?;
    let http = reqwest::Client::new();
    let mut results: Vec<serde_json::Value> = Vec::new();

    // Test coordinate: Tiananmen Square, Beijing
    let test_lon = 116.397428;
    let test_lat = 39.90923;

    // Test 1: Server-side reverse geocoding API
    let api_result = match reverse_geocode_dispatch(&http, &settings, test_lon, test_lat).await {
        Ok(geo) => {
            let addr = geo
                .address
                .or_else(|| {
                    let parts: Vec<&str> = [
                        geo.country.as_deref(),
                        geo.province.as_deref(),
                        geo.city.as_deref(),
                        geo.district.as_deref(),
                    ]
                    .into_iter()
                    .flatten()
                    .collect();
                    if parts.is_empty() {
                        None
                    } else {
                        Some(parts.join(""))
                    }
                })
                .unwrap_or_else(|| "OK".to_string());
            serde_json::json!({ "name": "serverApi", "success": true, "detail": addr })
        }
        Err(e) => {
            serde_json::json!({ "name": "serverApi", "success": false, "detail": e.to_string() })
        }
    };
    results.push(api_result);

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

    ok(serde_json::json!({ "results": results }))
}

/// Test Amap JS API key via map vector tile request.
async fn test_amap_js_key(http: &reqwest::Client, js_key: &str) -> serde_json::Value {
    let url = format!(
        "https://vdata.amap.com/nebula/v2?key={}&flds=road,building,region&t=10,855,340,0&p=16",
        js_key
    );
    match http.get(&url).send().await {
        Ok(resp) => {
            if resp.status().is_success() {
                serde_json::json!({ "name": "mapKey", "success": true, "detail": "OK" })
            } else {
                let detail = format!("HTTP {}", resp.status());
                serde_json::json!({ "name": "mapKey", "success": false, "detail": detail })
            }
        }
        Err(e) => {
            serde_json::json!({ "name": "mapKey", "success": false, "detail": e.to_string() })
        }
    }
}

/// Test Tianditu browser key via tile request.
async fn test_tianditu_browser_key(http: &reqwest::Client, tk: &str) -> serde_json::Value {
    let url = format!(
        "http://t0.tianditu.gov.cn/vec_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=vec&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILECOL=0&TILEROW=0&TILEMATRIX=1&tk={}",
        tk
    );
    match http.get(&url).send().await {
        Ok(resp) => {
            if resp.status().is_success() {
                serde_json::json!({ "name": "mapKey", "success": true, "detail": "OK" })
            } else {
                let detail = format!("HTTP {}", resp.status());
                serde_json::json!({ "name": "mapKey", "success": false, "detail": detail })
            }
        }
        Err(e) => {
            serde_json::json!({ "name": "mapKey", "success": false, "detail": e.to_string() })
        }
    }
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
