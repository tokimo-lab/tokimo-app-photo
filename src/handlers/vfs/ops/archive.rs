//! Archive (zip/tar/7z) operations on VFS files.
//!
//! TODO: Port full implementation from monorepo when `archiver`, `tempfile`,
//! and `walkdir` crates are added to Cargo.toml.

use axum::{
    extract::{Json, Path, State},
    http::StatusCode,
    response::Json as JsonResponse,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use ts_rs::TS;

use crate::AppState;
use crate::handlers::{ApiResponse, err400};
use crate::services::source::normalize_source_path;

#[derive(Debug, Serialize, Clone, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveEntryInfo {
    pub path: String,
    #[ts(type = "number")]
    pub size: u64,
    #[ts(type = "number | null")]
    pub compressed_size: Option<u64>,
    pub is_dir: bool,
    pub modified: Option<String>,
    pub encrypted: bool,
}

#[derive(Debug, Serialize, Clone, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveListResponse {
    pub format: String,
    pub entries: Vec<ArchiveEntryInfo>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivePathRequest {
    pub path: String,
    pub password: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveExtractRequest {
    pub path: String,
    pub dest: Option<String>,
    pub password: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveExtractFileRequest {
    pub path: String,
    pub entry: String,
    pub dest: Option<String>,
    pub password: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveCreateRequest {
    pub archive_path: String,
    pub sources: Vec<String>,
    pub password: Option<String>,
}

pub async fn archive_list(
    State(_state): State<Arc<AppState>>,
    Path(_source_id): Path<String>,
    Json(_body): Json<ArchivePathRequest>,
) -> Result<JsonResponse<ApiResponse<ArchiveListResponse>>, (StatusCode, JsonResponse<ApiResponse<ArchiveListResponse>>)>
{
    Err(err400("archive operations not yet available in this app".into()))
}

pub async fn archive_extract_all(
    State(_state): State<Arc<AppState>>,
    Path(_source_id): Path<String>,
    Json(_body): Json<ArchiveExtractRequest>,
) -> Result<JsonResponse<ApiResponse<()>>, (StatusCode, JsonResponse<ApiResponse<()>>)> {
    Err(err400("archive operations not yet available in this app".into()))
}

pub async fn archive_extract_file(
    State(_state): State<Arc<AppState>>,
    Path(_source_id): Path<String>,
    Json(_body): Json<ArchiveExtractFileRequest>,
) -> Result<JsonResponse<ApiResponse<()>>, (StatusCode, JsonResponse<ApiResponse<()>>)> {
    Err(err400("archive operations not yet available in this app".into()))
}

pub async fn archive_create(
    State(_state): State<Arc<AppState>>,
    Path(_source_id): Path<String>,
    Json(_body): Json<ArchiveCreateRequest>,
) -> Result<JsonResponse<ApiResponse<()>>, (StatusCode, JsonResponse<ApiResponse<()>>)> {
    Err(err400("archive operations not yet available in this app".into()))
}
