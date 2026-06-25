#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use tokimo_bus_client::BusClient;
use tokimo_bus_protocol::CallerCtx;
use uuid::Uuid;

use crate::bus_clients::jobs::{self, CreateJobRequest};
use crate::error::AppError;

#[derive(Debug, Clone, Serialize)]
pub struct RegisterFacesRequest {
    pub image_hash: String,
    pub source_app: String,
    pub source_id: String,
    pub faces: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct FaceCacheEntry {
    pub id: Uuid,
    pub image_hash: String,
    pub face_index: i32,
    pub bbox: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct MatchFaceRequest {
    pub image_hash: String,
    pub face_index: i32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MatchFaceResponse {
    pub face_cache_id: Uuid,
    pub person_id: Option<Uuid>,
    pub bbox: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PersonSummary {
    pub id: Uuid,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    pub face_count: i32,
    #[serde(default)]
    pub media_count: i32,
}

#[derive(Debug, Clone, Serialize)]
pub struct PersonsByIdsRequest {
    pub person_ids: Vec<Uuid>,
}

#[derive(Debug, Clone, Serialize)]
pub struct UpdatePersonRequest {
    pub person_id: Uuid,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MergePersonsRequest {
    pub target_id: Uuid,
    pub source_id: Uuid,
}

#[derive(Debug, Clone, Serialize)]
pub struct AssignFaceRequest {
    pub person_id: Uuid,
    pub image_hash: String,
    pub face_index: i32,
}

#[derive(Debug, Clone, Serialize)]
pub struct CreatePersonFromFaceRequest {
    pub name: Option<String>,
    pub image_hash: String,
    pub face_index: i32,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeleteSourceRequest {
    pub source_app: String,
    pub source_id: String,
}

pub fn photo_caller(user_id: Option<Uuid>) -> CallerCtx {
    CallerCtx {
        user_id: user_id.map(|id| id.to_string()),
        request_id: Uuid::new_v4().to_string(),
        workspace: None,
        caller_app_id: Some("photo".to_string()),
    }
}

/// Register faces via job queue (async with retry)
pub async fn register_faces_via_job(
    client: &BusClient,
    caller: CallerCtx,
    image_hash: &str,
    source_app: &str,
    source_id: &str,
    faces: Vec<serde_json::Value>,
) -> Result<Uuid, AppError> {
    let request = RegisterFacesRequest {
        image_hash: image_hash.to_string(),
        source_app: source_app.to_string(),
        source_id: source_id.to_string(),
        faces,
    };
    let job = jobs::create(
        client,
        caller,
        CreateJobRequest::new("person_sync_register_faces", serde_json::to_value(&request)?),
    )
    .await?;
    Ok(job.id)
}

/// Register faces via direct bus call (synchronous, for immediate use)
pub async fn register_faces(
    client: &BusClient,
    caller: CallerCtx,
    image_hash: &str,
    source_app: &str,
    source_id: &str,
    faces: Vec<serde_json::Value>,
) -> Result<Vec<FaceCacheEntry>, AppError> {
    let request = RegisterFacesRequest {
        image_hash: image_hash.to_string(),
        source_app: source_app.to_string(),
        source_id: source_id.to_string(),
        faces,
    };
    let response = invoke_json(client, "register_faces", caller, &request).await?;
    serde_json::from_slice(&response).map_err(|e| AppError::Internal(format!("person.register_faces decode: {e}")))
}

/// Match face via direct bus call (needs immediate response)
pub async fn match_face(
    client: &BusClient,
    caller: CallerCtx,
    image_hash: &str,
    face_index: i32,
) -> Result<MatchFaceResponse, AppError> {
    let request = MatchFaceRequest {
        image_hash: image_hash.to_string(),
        face_index,
    };
    let response = invoke_json(client, "match_face", caller, &request).await?;
    serde_json::from_slice(&response).map_err(|e| AppError::Internal(format!("person.match_face decode: {e}")))
}

pub async fn persons_by_ids(
    client: &BusClient,
    caller: CallerCtx,
    person_ids: Vec<Uuid>,
) -> Result<Vec<PersonSummary>, AppError> {
    let request = PersonsByIdsRequest { person_ids };
    let response = invoke_json(client, "persons_by_ids", caller, &request).await?;
    serde_json::from_slice(&response).map_err(|e| AppError::Internal(format!("person.persons_by_ids decode: {e}")))
}

pub async fn update_person(
    client: &BusClient,
    caller: CallerCtx,
    person_id: Uuid,
    name: Option<String>,
    avatar_url: Option<String>,
) -> Result<PersonSummary, AppError> {
    let request = UpdatePersonRequest {
        person_id,
        name,
        avatar_url,
    };
    let response = invoke_json(client, "update_person", caller, &request).await?;
    serde_json::from_slice(&response).map_err(|e| AppError::Internal(format!("person.update_person decode: {e}")))
}

pub async fn merge_persons(
    client: &BusClient,
    caller: CallerCtx,
    target_id: Uuid,
    source_id: Uuid,
) -> Result<(), AppError> {
    let request = MergePersonsRequest { target_id, source_id };
    let _ = invoke_json(client, "merge_persons", caller, &request).await?;
    Ok(())
}

pub async fn assign_face(
    client: &BusClient,
    caller: CallerCtx,
    person_id: Uuid,
    image_hash: &str,
    face_index: i32,
) -> Result<MatchFaceResponse, AppError> {
    let request = AssignFaceRequest {
        person_id,
        image_hash: image_hash.to_string(),
        face_index,
    };
    let response = invoke_json(client, "assign_face", caller, &request).await?;
    serde_json::from_slice(&response).map_err(|e| AppError::Internal(format!("person.assign_face decode: {e}")))
}

pub async fn create_person_from_face(
    client: &BusClient,
    caller: CallerCtx,
    name: Option<String>,
    image_hash: &str,
    face_index: i32,
) -> Result<MatchFaceResponse, AppError> {
    let request = CreatePersonFromFaceRequest {
        name,
        image_hash: image_hash.to_string(),
        face_index,
    };
    let response = invoke_json(client, "create_person_from_face", caller, &request).await?;
    serde_json::from_slice(&response)
        .map_err(|e| AppError::Internal(format!("person.create_person_from_face decode: {e}")))
}

/// Delete source via job queue (async with retry)
pub async fn delete_source_via_job(
    client: &BusClient,
    caller: CallerCtx,
    source_app: &str,
    source_id: &str,
) -> Result<Uuid, AppError> {
    let request = DeleteSourceRequest {
        source_app: source_app.to_string(),
        source_id: source_id.to_string(),
    };
    let job = jobs::create(
        client,
        caller,
        CreateJobRequest::new("person_sync_delete_source", serde_json::to_value(&request)?),
    )
    .await?;
    Ok(job.id)
}

/// Delete source via direct bus call (synchronous, for immediate use)
pub async fn delete_source(
    client: &BusClient,
    caller: CallerCtx,
    source_app: &str,
    source_id: &str,
) -> Result<(), AppError> {
    let request = DeleteSourceRequest {
        source_app: source_app.to_string(),
        source_id: source_id.to_string(),
    };
    let _ = invoke_json(client, "delete_source", caller, &request).await?;
    Ok(())
}

async fn invoke_json<T: Serialize>(
    client: &BusClient,
    method: &str,
    caller: CallerCtx,
    request: &T,
) -> Result<Vec<u8>, AppError> {
    let payload =
        serde_json::to_vec(request).map_err(|e| AppError::Internal(format!("person.{method} encode: {e}")))?;
    client
        .invoke("person", method, payload, caller)
        .await
        .map_err(|e| AppError::Internal(format!("person.{method} via bus: {e}")))
}
