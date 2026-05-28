//! AI handler stubs — OCR, CLIP, face detection. All return empty/success
//! since the perception worker is not linked in this sidecar binary.

use std::sync::Arc;

use axum::{Json, extract::{Path, State}};

use crate::ctx::AppCtx;
use crate::db::repos::photo_repo::PhotoRepo;
use crate::error::AppError;

use super::{ok, ok_simple, parse_uuid};

macro_rules! ai_stub {
    ($name:ident) => {
        pub async fn $name(
            State(_ctx): State<Arc<AppCtx>>,
        ) -> Result<Json<serde_json::Value>, AppError> {
            tracing::warn!("photo AI not available in sidecar: {}", stringify!($name));
            ok_simple()
        }
    };
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

ai_stub!(ocr_scan, path);
ai_stub!(ocr_search, path);
ai_stub!(clear_ocr_results, path);
ai_stub!(clear_face_results, path);
ai_stub!(clear_clip_results, path);
ai_stub!(clear_thumbnails, path);
ai_stub!(clip_embed, path);
ai_stub!(clip_search, path);
ai_stub!(face_detect, path);
ai_stub!(get_photo_ai_settings);
ai_stub!(update_photo_ai_settings);
ai_stub!(test_photo_ai_connection);
ai_stub!(get_photo_geo_settings);
ai_stub!(update_photo_geo_settings);
ai_stub!(test_photo_geo_connection);
ai_stub!(refresh_exif, path);
ai_stub!(refresh_thumbnail, path);
ai_stub!(refresh_faces, path);
ai_stub!(refresh_ocr, path);
ai_stub!(refresh_clip, path);

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

/// POST /api/apps/photo/{photoId}/ocr
pub async fn create_ocr_result(
    State(_ctx): State<Arc<AppCtx>>,
    Path(_id): Path<String>,
    Json(_body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, AppError> {
    tracing::warn!("photo AI not available in sidecar: create_ocr_result");
    ok_simple()
}

/// PATCH /api/apps/photo/{photoId}/ocr/{ocrId}
pub async fn update_ocr_result(
    State(_ctx): State<Arc<AppCtx>>,
    Path((_photo_id, _ocr_id)): Path<(String, String)>,
    Json(_body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, AppError> {
    tracing::warn!("photo AI not available in sidecar: update_ocr_result");
    ok_simple()
}

/// DELETE /api/apps/photo/{photoId}/ocr/{ocrId}
pub async fn delete_ocr_result(
    State(ctx): State<Arc<AppCtx>>,
    Path((_photo_id, ocr_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, AppError> {
    let ocr_id_int: i32 = ocr_id
        .parse()
        .map_err(|_| AppError::BadRequest(format!("invalid ocr id: {ocr_id}")))?;
    PhotoRepo::delete_ocr_result(&ctx.db, ocr_id_int).await?;
    ok_simple()
}
