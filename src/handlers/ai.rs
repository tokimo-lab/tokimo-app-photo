use axum::{
    Json,
    extract::{Path, Query, State},
    response::IntoResponse,
};
use serde::Deserialize;
use std::sync::Arc;

use crate::AppState;
use crate::error::{AppError, OptionExt};
use crate::handlers::user::AuthUser;
use crate::repos::{PhotoLibraryRepo, PhotoRepo};
use crate::services::clip::PhotoClipService;
use crate::services::geo::reverse_geocode_dispatch;
use crate::services::ocr::PhotoOcrService;
use crate::services::preempt;

use super::{ApiResponse, ok, parse_uuid};

// ── Stubs ────────────────────────────────────────────────────────────────────

macro_rules! ai_stub {
    ($name:ident, path) => {
        pub async fn $name(
            State(_state): State<Arc<AppState>>,
            Path(_id): Path<String>,
        ) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
            tracing::warn!("photo AI not available in sidecar: {}", stringify!($name));
            Ok(ok(serde_json::json!(null)))
        }
    };
}

ai_stub!(refresh_thumbnail, path);

/// DELETE /{id}/clear-thumbnails — delete all thumbnail files for a library.
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
    let storage = state.storage.get().expect("storage not initialized");
    for pid in &photo_ids {
        for w in &widths {
            let key = format!("thumbs/photo/{pid}.{w}x0.webp");
            if storage.delete(&key).await.is_ok() {
                deleted += 1;
            }
        }
    }

    Ok(ok(serde_json::json!({ "deletedCount": deleted })))
}

// ── EXIF refresh ─────────────────────────────────────────────────────────────

pub async fn refresh_exif(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    use crate::db::entities::photos;
    use sea_orm::{ActiveModelTrait, EntityTrait};
    let photo_id = parse_uuid(&id)?;
    let photo = photos::Entity::find_by_id(photo_id)
        .one(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Photo not found".into()))?;
    let source_id = photo
        .source_id
        .ok_or_else(|| AppError::BadRequest("Photo has no source".into()))?;
    let vfs = state
        .sources
        .ensure_vfs(&source_id.to_string())
        .await
        .map_err(|e| AppError::Internal(format!("ensure_vfs: {e}")))?;
    let fp = std::path::Path::new(&photo.path);
    let bytes = vfs
        .read_bytes(fp, 0, Some(256 * 1024))
        .await
        .map_err(|e| AppError::Internal(format!("read photo bytes: {e}")))?;
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
        apply_exif_update(&state.db, photo_id, exif).await?;
    }
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
            .update(&state.db)
            .await?;
        }
    }
    Ok(ok(serde_json::json!({ "status": "ok" })))
}

async fn apply_exif_update(
    db: &sea_orm::DatabaseConnection,
    photo_id: uuid::Uuid,
    exif: &tokimo_package_image::ExifData,
) -> Result<(), AppError> {
    use crate::db::entities::photos;
    use sea_orm::{ActiveModelTrait, Set};
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

// ── Settings: photo-ai ───────────────────────────────────────────────────────

pub async fn get_photo_ai_settings(
    State(state): State<Arc<AppState>>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    use crate::config::PhotoAiSettings;
    use crate::db::repos::system_config_repo::SystemConfigRepo;
    let settings: PhotoAiSettings = SystemConfigRepo::get(&state.db).await?;
    Ok(ok(serde_json::to_value(settings).unwrap()))
}

pub async fn update_photo_ai_settings(
    State(state): State<Arc<AppState>>,
    Json(body): Json<crate::config::PhotoAiSettings>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    use crate::db::repos::system_config_repo::SystemConfigRepo;
    SystemConfigRepo::set(&state.db, &body).await?;
    Ok(ok(serde_json::to_value(body).unwrap()))
}

pub async fn test_photo_ai_connection(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let models_ready = state.models_ready();
    let ocr_ready = models_ready && state.is_ocr_enabled();
    let clip_ready = models_ready && state.is_clip_enabled();
    let face_ready = models_ready && state.is_face_enabled();
    let detail = format!(
        "OCR: {}, CLIP: {}, Face: {}",
        if ocr_ready { "✓" } else { "✗" },
        if clip_ready { "✓" } else { "✗" },
        if face_ready { "✓" } else { "✗" }
    );
    let results = serde_json::json!([{"name": "aiService", "success": models_ready, "detail": if models_ready { detail } else { "Models not downloaded".to_string() }, "modelsReady": models_ready}]);
    ok(serde_json::json!({ "results": results })).into_response()
}

// ── Settings: photo-geo ──────────────────────────────────────────────────────

pub async fn get_photo_geo_settings(
    State(state): State<Arc<AppState>>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    use crate::config::PhotoGeoSettings;
    use crate::db::repos::system_config_repo::SystemConfigRepo;
    let settings: PhotoGeoSettings = SystemConfigRepo::get(&state.db).await?;
    Ok(ok(serde_json::to_value(settings).unwrap()))
}

pub async fn update_photo_geo_settings(
    State(state): State<Arc<AppState>>,
    Json(body): Json<crate::config::PhotoGeoSettings>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    use crate::db::repos::system_config_repo::SystemConfigRepo;
    SystemConfigRepo::set(&state.db, &body).await?;
    Ok(ok(serde_json::to_value(body).unwrap()))
}

pub async fn test_photo_geo_connection(
    State(state): State<Arc<AppState>>,
) -> Json<ApiResponse<serde_json::Value>> {
    use crate::config::PhotoGeoSettings;
    use crate::db::repos::system_config_repo::SystemConfigRepo;
    let settings: PhotoGeoSettings = match SystemConfigRepo::get(&state.db).await {
        Ok(s) => s,
        Err(_) => return ok(serde_json::json!({ "results": [] })),
    };
    let http = reqwest::Client::new();
    let mut results: Vec<serde_json::Value> = Vec::new();
    let test_lon = 116.397428;
    let test_lat = 39.90923;
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
    match settings.provider.as_str() {
        "amap" => {
            if let Some(js_key) = settings
                .amap_js_api_key
                .as_deref()
                .filter(|k| !k.is_empty())
            {
                results.push(test_amap_js_key(&http, js_key).await);
            }
        }
        "tianditu" => {
            if let Some(bk) = settings
                .tianditu_browser_key
                .as_deref()
                .filter(|k| !k.is_empty())
            {
                results.push(test_tianditu_browser_key(&http, bk).await);
            }
        }
        _ => {}
    }
    ok(serde_json::json!({ "results": results }))
}

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
                serde_json::json!({ "name": "mapKey", "success": false, "detail": format!("HTTP {}", resp.status()) })
            }
        }
        Err(e) => {
            serde_json::json!({ "name": "mapKey", "success": false, "detail": e.to_string() })
        }
    }
}

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
                serde_json::json!({ "name": "mapKey", "success": false, "detail": format!("HTTP {}", resp.status()) })
            }
        }
        Err(e) => {
            serde_json::json!({ "name": "mapKey", "success": false, "detail": e.to_string() })
        }
    }
}

// ── Library-scoped scan triggers ─────────────────────────────────────────────

pub async fn ocr_scan(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    auth: AuthUser,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let app_id = parse_uuid(&id)?;
    let user_id: uuid::Uuid = auth
        .user_id
        .parse()
        .map_err(|_| AppError::Unauthorized("invalid auth user id".into()))?;
    PhotoLibraryRepo::get_by_id(&state.db, app_id)
        .await?
        .not_found(format!("photo library {id} not found"))?;
    preempt::preempt_scan_for(&state, app_id, "photo_ocr_scan").await?;
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

pub async fn clip_embed(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    auth: AuthUser,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let app_id = parse_uuid(&id)?;
    let user_id: uuid::Uuid = auth
        .user_id
        .parse()
        .map_err(|_| AppError::Unauthorized("invalid auth user id".into()))?;
    PhotoLibraryRepo::get_by_id(&state.db, app_id)
        .await?
        .not_found(format!("photo library {id} not found"))?;
    preempt::preempt_scan_for(&state, app_id, "photo_clip_scan").await?;
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

// ── Per-photo refresh ────────────────────────────────────────────────────────

pub async fn refresh_clip(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    auth: AuthUser,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let photo_id = parse_uuid(&id)?;
    let user_id: uuid::Uuid = auth
        .user_id
        .parse()
        .map_err(|_| AppError::Unauthorized("invalid auth user id".into()))?;
    preempt::preempt_scan_child_for_photo(&state, "photo_clip", photo_id).await?;
    let (job, _) = crate::db::repos::job_repo::JobRepo::enqueue_with_dedupe(
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

pub async fn refresh_faces(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    auth: AuthUser,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let photo_id = parse_uuid(&id)?;
    let user_id: uuid::Uuid = auth
        .user_id
        .parse()
        .map_err(|_| AppError::Unauthorized("invalid auth user id".into()))?;
    preempt::preempt_scan_child_for_photo(&state, "photo_face", photo_id).await?;
    let (job, _) = crate::db::repos::job_repo::JobRepo::enqueue_with_dedupe(
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

pub async fn refresh_ocr(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    auth: AuthUser,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let photo_id = parse_uuid(&id)?;
    let user_id: uuid::Uuid = auth
        .user_id
        .parse()
        .map_err(|_| AppError::Unauthorized("invalid auth user id".into()))?;
    preempt::preempt_scan_child_for_photo(&state, "photo_ocr", photo_id).await?;
    let (job, _) = crate::db::repos::job_repo::JobRepo::enqueue_with_dedupe(
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

// ── Search ───────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct OcrSearchQuery {
    pub q: String,
}

#[derive(Debug, Deserialize)]
pub struct ClipSearchQuery {
    pub q: String,
}

pub async fn ocr_search(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(q): Query<OcrSearchQuery>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let app_id = parse_uuid(&id)?;
    let results = PhotoOcrService::search_ocr_text(&state.db, app_id, &q.q).await?;
    Ok(ok(serde_json::to_value(results).unwrap()))
}

pub async fn clip_search(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(q): Query<ClipSearchQuery>,
    auth: AuthUser,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let app_id = parse_uuid(&id)?;
    let user_id = parse_uuid(&auth.user_id)?;
    let results = PhotoClipService::search(&state.db, &state, app_id, &q.q, user_id).await?;
    Ok(ok(serde_json::to_value(results).unwrap()))
}

// ── Clear results ────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ClearOcrQuery {
    pub model: Option<String>,
}

pub async fn clear_ocr_results(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(q): Query<ClearOcrQuery>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let app_id = parse_uuid(&id)?;
    let deleted =
        PhotoRepo::clear_ocr_results_for_app(&state.db, app_id, q.model.as_deref()).await?;
    Ok(ok(serde_json::json!({ "deletedCount": deleted })))
}

pub async fn clear_face_results(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let app_id = parse_uuid(&id)?;
    let deleted = PhotoRepo::clear_face_results_for_app(&state.db, app_id).await?;
    Ok(ok(serde_json::json!({ "deletedCount": deleted })))
}

pub async fn clear_clip_results(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let app_id = parse_uuid(&id)?;
    let deleted = PhotoRepo::clear_clip_results_for_app(&state.db, app_id).await?;
    Ok(ok(serde_json::json!({ "deletedCount": deleted })))
}

pub async fn clear_all_ocr_results(
    State(state): State<Arc<AppState>>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    PhotoRepo::clear_all_ocr_results(&state.db).await?;
    Ok(ok(serde_json::json!(null)))
}

// ── OCR CRUD ─────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateOcrResultInput {
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub corners: Option<Vec<[f64; 2]>>,
}

pub async fn get_photo_ocr_results(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let photo_id = parse_uuid(&id)?;
    let rows = PhotoRepo::get_ocr_results(&state.db, photo_id).await?;
    let results: Vec<serde_json::Value> = rows.into_iter().map(|r| serde_json::json!({"id": r.id.to_string(), "text": r.text, "x": r.x, "y": r.y, "w": r.w, "h": r.h, "angle": r.angle, "score": r.score, "paragraphId": r.paragraph_id, "charPositions": r.char_positions, "modelName": r.model_name, "positioningType": r.positioning_type, "corners": r.corners})).collect();
    Ok(ok(serde_json::to_value(results).unwrap()))
}

pub async fn create_ocr_result(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(input): Json<CreateOcrResultInput>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let photo_id = parse_uuid(&id)?;
    let created = PhotoOcrService::create_ocr_result(&state.db, photo_id, input).await?;
    Ok(ok(
        serde_json::json!({"id": created.id.to_string(), "text": created.text, "x": created.x, "y": created.y, "w": created.w, "h": created.h, "angle": created.angle, "score": created.score, "paragraphId": created.paragraph_id, "charPositions": created.char_positions, "modelName": created.model_name, "positioningType": created.positioning_type, "corners": created.corners}),
    ))
}

pub async fn update_ocr_result(
    State(state): State<Arc<AppState>>,
    Path(ocr_id): Path<i32>,
    Json(input): Json<UpdateOcrResultInput>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let updated = PhotoOcrService::update_ocr_result(&state.db, ocr_id, input).await?;
    Ok(ok(
        serde_json::json!({"id": updated.id.to_string(), "text": updated.text, "x": updated.x, "y": updated.y, "w": updated.w, "h": updated.h, "angle": updated.angle, "score": updated.score, "paragraphId": updated.paragraph_id, "charPositions": updated.char_positions, "modelName": updated.model_name, "positioningType": updated.positioning_type, "corners": updated.corners}),
    ))
}

pub async fn delete_ocr_result(
    State(state): State<Arc<AppState>>,
    Path(ocr_id): Path<i32>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    PhotoOcrService::delete_ocr_result(&state.db, ocr_id).await?;
    Ok(ok(serde_json::json!({ "deleted": true })))
}
