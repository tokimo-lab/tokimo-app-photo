use axum::{
    Json,
    extract::{Path, Query, State},
};
use serde::Deserialize;
use std::sync::Arc;

use crate::AppState;
use crate::apps::photo::repos::PhotoLibraryRepo;
use crate::db::pagination::PageInput;
use crate::error::{AppError, OptionExt};
use crate::handlers::user::AuthUser;
use crate::handlers::{ApiResponse, ok};

use super::parse_uuid;

/// POST /api/apps/photo/{id}/photos/face-detect
pub async fn face_detect(
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

    crate::apps::photo::services::preempt::preempt_scan_for(&state, app_id, "photo_face_scan").await?;

    crate::db::repos::job_repo::JobRepo::create_job(
        &state.db,
        "photo_face_scan",
        serde_json::json!({ "appId": app_id.to_string() }),
        None,
        Some(user_id),
    )
    .await?;
    Ok(ok(serde_json::json!({"status": "started"})))
}

/// GET /api/apps/photo/{id}/persons
pub async fn list_persons(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let app_id = parse_uuid(&id)?;
    let persons = crate::apps::photo::services::face::PhotoFaceService::list_persons(&state.db, app_id).await?;
    Ok(ok(serde_json::to_value(persons).unwrap()))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonPhotosQuery {
    pub page: Option<u64>,
    pub page_size: Option<u64>,
}

/// GET /api/apps/photo/{id}/persons/{personId}/photos
pub async fn person_photos(
    State(state): State<Arc<AppState>>,
    Path((id, person_id)): Path<(String, String)>,
    Query(q): Query<PersonPhotosQuery>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let _app_id = parse_uuid(&id)?;
    let pid = parse_uuid(&person_id)?;
    let page = PageInput {
        page: q.page.unwrap_or(1),
        page_size: q.page_size.unwrap_or(80),
    };
    let result = crate::apps::photo::services::face::PhotoFaceService::photos_by_person(&state.db, pid, &page).await?;
    Ok(ok(serde_json::to_value(result).unwrap()))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergePersonsBody {
    pub target_id: String,
    pub source_id: String,
}

/// POST /api/apps/photo/{id}/persons/merge
pub async fn merge_persons(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(body): Json<MergePersonsBody>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let _app_id = parse_uuid(&id)?;
    let target_id = parse_uuid(&body.target_id)?;
    let source_id = parse_uuid(&body.source_id)?;

    crate::apps::photo::services::face::PhotoFaceService::merge_persons(&state.db, target_id, source_id).await?;

    Ok(ok(serde_json::json!({"success": true})))
}

#[derive(Debug, Deserialize)]
pub struct RenamePersonBody {
    pub name: String,
}

/// PATCH /api/apps/photo/{id}/persons/{personId}
pub async fn rename_person(
    State(state): State<Arc<AppState>>,
    Path((id, person_id)): Path<(String, String)>,
    Json(body): Json<RenamePersonBody>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let _app_id = parse_uuid(&id)?;
    let pid = parse_uuid(&person_id)?;

    crate::apps::photo::services::face::PhotoFaceService::rename_person(&state.db, pid, &body.name).await?;

    Ok(ok(serde_json::json!({"success": true})))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignFaceBody {
    pub person_id: String,
}

/// PATCH /api/photos/{id}/faces/{faceId}/assign
pub async fn assign_face_to_person(
    State(state): State<Arc<AppState>>,
    Path((photo_id, face_id)): Path<(String, String)>,
    Json(body): Json<AssignFaceBody>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let _photo_id = parse_uuid(&photo_id)?;
    let fid: i32 = face_id
        .parse()
        .map_err(|_| AppError::BadRequest(format!("invalid face id: {face_id}")))?;
    let person_id = parse_uuid(&body.person_id)?;

    crate::apps::photo::services::face::PhotoFaceService::assign_face_to_person(&state.db, fid, person_id).await?;

    Ok(ok(serde_json::json!({"success": true})))
}

#[derive(Debug, Deserialize)]
pub struct CreatePersonFromFaceBody {
    pub name: Option<String>,
}

/// POST /api/photos/{id}/faces/{faceId}/create-person
pub async fn create_person_from_face(
    State(state): State<Arc<AppState>>,
    Path((photo_id, face_id)): Path<(String, String)>,
    Json(body): Json<CreatePersonFromFaceBody>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let _photo_id = parse_uuid(&photo_id)?;
    let fid: i32 = face_id
        .parse()
        .map_err(|_| AppError::BadRequest(format!("invalid face id: {face_id}")))?;

    let person =
        crate::apps::photo::services::face::PhotoFaceService::create_person_from_face(&state.db, fid, body.name)
            .await?;

    Ok(ok(serde_json::to_value(person).unwrap()))
}

/// GET /api/photos/{id}/faces
pub async fn get_photo_faces(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let photo_id = parse_uuid(&id)?;
    let faces = crate::apps::photo::services::face::PhotoFaceService::get_photo_faces(&state.db, photo_id).await?;
    Ok(ok(serde_json::to_value(faces).unwrap()))
}
