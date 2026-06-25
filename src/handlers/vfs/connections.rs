//! VFS connection management handlers.
//!
//! TODO: Port full implementation from monorepo when VfsDto/VfsConnectionStatus
//! models and full VfsRepo CRUD methods are available.

use axum::{extract::State, response::Json};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::AppState;
use crate::db::models::media::vfs::VfsStatus;
use crate::handlers::{ApiResponse, err500, ok};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncSourcesRequest {
    pub vfs_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthResponse {
    pub ok: bool,
}

pub async fn health() -> Json<ApiResponse<HealthResponse>> {
    ok(HealthResponse { ok: true })
}

pub async fn vfs_status(State(state): State<Arc<AppState>>) -> Json<ApiResponse<Vec<VfsStatus>>> {
    ok(state.sources.status_all().await)
}

pub async fn vfs_sync(
    State(state): State<Arc<AppState>>,
    Json(body): Json<SyncSourcesRequest>,
) -> Result<
    Json<ApiResponse<Vec<VfsStatus>>>,
    (axum::http::StatusCode, Json<ApiResponse<Vec<VfsStatus>>>),
> {
    let statuses = if let Some(source_id) = body.vfs_id {
        state
            .sources
            .sync_source(&source_id)
            .await
            .map_err(err500)?
            .into_iter()
            .collect()
    } else {
        state.sources.sync_all().await.map_err(err500)?
    };
    Ok(ok(statuses))
}
