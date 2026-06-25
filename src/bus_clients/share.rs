use serde::{Deserialize, Serialize};
use tokimo_bus_client::BusClient;
use tokimo_bus_protocol::CallerCtx;
use uuid::Uuid;

use crate::error::AppError;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertShareLinkRequest {
    pub resource_type: String,
    pub resource_id: Uuid,
    pub resource_name: String,
    pub cover_image: Option<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetShareLinkRequest {
    pub resource_type: String,
    pub resource_id: Uuid,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvePublicShareRequest {
    pub token: String,
    pub resource_type: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareLinkResponse {
    pub enabled: bool,
    pub token: Option<String>,
    pub url: Option<String>,
    pub resource_id: Option<Uuid>,
}

pub fn photo_caller(user_id: Option<Uuid>) -> CallerCtx {
    CallerCtx {
        user_id: user_id.map(|id| id.to_string()),
        request_id: Uuid::new_v4().to_string(),
        workspace: None,
        caller_app_id: Some("photo".to_string()),
    }
}

pub async fn get_link(
    client: &BusClient,
    caller: CallerCtx,
    resource_type: &str,
    resource_id: Uuid,
) -> Result<ShareLinkResponse, AppError> {
    let request = GetShareLinkRequest {
        resource_type: resource_type.to_string(),
        resource_id,
    };
    invoke_json(client, "get_link", caller, &request).await
}

pub async fn upsert_link(
    client: &BusClient,
    caller: CallerCtx,
    request: UpsertShareLinkRequest,
) -> Result<ShareLinkResponse, AppError> {
    invoke_json(client, "upsert_link", caller, &request).await
}

pub async fn resolve_public(
    client: &BusClient,
    caller: CallerCtx,
    token: &str,
    resource_type: &str,
) -> Result<ShareLinkResponse, AppError> {
    let request = ResolvePublicShareRequest {
        token: token.to_string(),
        resource_type: resource_type.to_string(),
    };
    invoke_json(client, "resolve_public", caller, &request).await
}

async fn invoke_json<T, R>(
    client: &BusClient,
    method: &str,
    caller: CallerCtx,
    request: &T,
) -> Result<R, AppError>
where
    T: Serialize,
    R: for<'de> Deserialize<'de>,
{
    let payload = serde_json::to_vec(request)
        .map_err(|e| AppError::Internal(format!("share.{method} encode: {e}")))?;
    let response = client
        .invoke("share_registry", method, payload, caller)
        .await
        .map_err(|e| AppError::Internal(format!("share_registry.{method} via bus: {e}")))?;
    serde_json::from_slice(&response)
        .map_err(|e| AppError::Internal(format!("share_registry.{method} decode: {e}")))
}
