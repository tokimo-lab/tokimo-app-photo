#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use tokimo_bus_client::BusClient;
use tokimo_bus_protocol::CallerCtx;
use uuid::Uuid;

use crate::bus_clients::jobs::{self, CreateJobRequest};
use crate::error::AppError;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterFacesRequest {
    pub image_hash: String,
    pub source_app: String,
    pub source_id: String,
    pub faces: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FaceCacheEntry {
    pub id: Uuid,
    pub image_hash: String,
    pub face_index: i32,
    pub bbox: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchFaceRequest {
    pub image_hash: String,
    pub face_index: i32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchFaceResponse {
    pub face_cache_id: Uuid,
    pub person_id: Option<Uuid>,
    pub bbox: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
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
        CreateJobRequest::new("person_register_faces", serde_json::to_value(&request)?),
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
    serde_json::from_slice(&response)
        .map_err(|e| AppError::Internal(format!("person.register_faces decode: {e}")))
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
    serde_json::from_slice(&response)
        .map_err(|e| AppError::Internal(format!("person.match_face decode: {e}")))
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
        CreateJobRequest::new("person_delete_source", serde_json::to_value(&request)?),
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
    let payload = serde_json::to_vec(request)
        .map_err(|e| AppError::Internal(format!("person.{method} encode: {e}")))?;
    client
        .invoke("person", method, payload, caller)
        .await
        .map_err(|e| AppError::Internal(format!("person.{method} via bus: {e}")))
}
