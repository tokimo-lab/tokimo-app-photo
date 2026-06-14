use axum::{
    extract::{Json, Multipart, Path, Query, State},
    http::StatusCode,
    response::Json as JsonResponse,
};
use serde::Deserialize;
use std::sync::Arc;
use tracing::debug;

use crate::AppState;
use crate::handlers::{ApiResponse, err400, err404, err500, ok_empty};
use crate::services::source::normalize_source_path;

#[derive(Deserialize)]
pub struct SourcePathRequest {
    pub path: String,
}

#[derive(Deserialize)]
pub struct WriteFileRequest {
    pub path: String,
    #[serde(default)]
    pub content: String,
}

#[derive(Deserialize)]
pub struct SourceRenameRequest {
    pub from: String,
    pub to: String,
}

#[derive(Deserialize)]
pub struct SourceMoveRequest {
    pub from: String,
    #[serde(rename = "toDir")]
    pub to_dir: String,
}

pub async fn mkdir_vfs(
    State(state): State<Arc<AppState>>,
    Path(source_id): Path<String>,
    Json(body): Json<SourcePathRequest>,
) -> Result<JsonResponse<ApiResponse<()>>, (StatusCode, JsonResponse<ApiResponse<()>>)> {
    let path = normalize_source_path(&body.path).map_err(err400)?;
    let vfs = state.sources.ensure_vfs(&source_id).await.map_err(err404)?;
    debug!("mkdir source={} path={}", source_id, path);
    vfs.mkdir(std::path::Path::new(&path))
        .await
        .map(|()| ok_empty())
        .map_err(|err| err500(err.to_string()))
}

pub async fn delete_vfs_file(
    State(state): State<Arc<AppState>>,
    Path(source_id): Path<String>,
    Json(body): Json<SourcePathRequest>,
) -> Result<JsonResponse<ApiResponse<()>>, (StatusCode, JsonResponse<ApiResponse<()>>)> {
    let path = normalize_source_path(&body.path).map_err(err400)?;
    let vfs = state.sources.ensure_vfs(&source_id).await.map_err(err404)?;
    debug!("delete file source={} path={}", source_id, path);
    vfs.delete_file(std::path::Path::new(&path))
        .await
        .map(|()| ok_empty())
        .map_err(|err| err500(err.to_string()))
}

pub async fn delete_vfs_dir(
    State(state): State<Arc<AppState>>,
    Path(source_id): Path<String>,
    Json(body): Json<SourcePathRequest>,
) -> Result<JsonResponse<ApiResponse<()>>, (StatusCode, JsonResponse<ApiResponse<()>>)> {
    let path = normalize_source_path(&body.path).map_err(err400)?;
    let vfs = state.sources.ensure_vfs(&source_id).await.map_err(err404)?;
    debug!("delete dir source={} path={}", source_id, path);
    vfs.delete_dir(std::path::Path::new(&path))
        .await
        .map(|()| ok_empty())
        .map_err(|err| err500(err.to_string()))
}

pub async fn rename_vfs_path(
    State(state): State<Arc<AppState>>,
    Path(source_id): Path<String>,
    Json(body): Json<SourceRenameRequest>,
) -> Result<JsonResponse<ApiResponse<()>>, (StatusCode, JsonResponse<ApiResponse<()>>)> {
    let from = normalize_source_path(&body.from).map_err(err400)?;
    let to = normalize_source_path(&body.to).map_err(err400)?;
    let vfs = state.sources.ensure_vfs(&source_id).await.map_err(err404)?;
    debug!("rename source={} from={} to={}", source_id, from, to);
    vfs.rename(std::path::Path::new(&from), std::path::Path::new(&to))
        .await
        .map(|()| ok_empty())
        .map_err(|err| err500(err.to_string()))
}

pub async fn copy_vfs_path(
    State(state): State<Arc<AppState>>,
    Path(source_id): Path<String>,
    Json(body): Json<SourceRenameRequest>,
) -> Result<JsonResponse<ApiResponse<()>>, (StatusCode, JsonResponse<ApiResponse<()>>)> {
    let from = normalize_source_path(&body.from).map_err(err400)?;
    let to = normalize_source_path(&body.to).map_err(err400)?;
    let vfs = state.sources.ensure_vfs(&source_id).await.map_err(err404)?;
    debug!("copy source={} from={} to={}", source_id, from, to);
    vfs.copy(std::path::Path::new(&from), std::path::Path::new(&to))
        .await
        .map(|()| ok_empty())
        .map_err(|err| err500(err.to_string()))
}

pub async fn move_vfs_path(
    State(state): State<Arc<AppState>>,
    Path(source_id): Path<String>,
    Json(body): Json<SourceMoveRequest>,
) -> Result<JsonResponse<ApiResponse<()>>, (StatusCode, JsonResponse<ApiResponse<()>>)> {
    let from = normalize_source_path(&body.from).map_err(err400)?;
    let to_dir = normalize_source_path(&body.to_dir).map_err(err400)?;
    let vfs = state.sources.ensure_vfs(&source_id).await.map_err(err404)?;
    debug!("move source={} from={} to_dir={}", source_id, from, to_dir);
    vfs.move_file(std::path::Path::new(&from), std::path::Path::new(&to_dir))
        .await
        .map(|()| ok_empty())
        .map_err(|err| err500(err.to_string()))
}

pub async fn put_vfs_file(
    State(state): State<Arc<AppState>>,
    Path(source_id): Path<String>,
    Json(body): Json<WriteFileRequest>,
) -> Result<JsonResponse<ApiResponse<()>>, (StatusCode, JsonResponse<ApiResponse<()>>)> {
    let path = normalize_source_path(&body.path).map_err(err400)?;
    let vfs = state.sources.ensure_vfs(&source_id).await.map_err(err404)?;
    let data = body.content.into_bytes();
    debug!("put file source={} path={} bytes={}", source_id, path, data.len());
    vfs.put(std::path::Path::new(&path), data)
        .await
        .map(|()| ok_empty())
        .map_err(|err| err500(err.to_string()))
}

#[derive(Deserialize)]
pub struct SourceUploadQuery {
    pub path: String,
    pub filename: String,
}

/// Upload a binary file to a file system via multipart/form-data.
///
/// Query params: `path` (target dir), `filename` (target file name)
/// Body: multipart/form-data with a single file part containing the raw bytes.
pub async fn upload_vfs_file(
    State(state): State<Arc<AppState>>,
    Path(source_id): Path<String>,
    Query(query): Query<SourceUploadQuery>,
    mut multipart: Multipart,
) -> Result<JsonResponse<ApiResponse<()>>, (StatusCode, JsonResponse<ApiResponse<()>>)> {
    if query.path.contains('\0') || query.filename.contains('\0') {
        return Err(err400("invalid path".into()));
    }
    if query.filename.contains('/') || query.filename.contains("..") {
        return Err(err400("filename must not contain '/' or '..'".into()));
    }

    let dir = normalize_source_path(&query.path).map_err(err400)?;
    let full_path = if dir.ends_with('/') {
        format!("{}{}", dir, query.filename)
    } else {
        format!("{}/{}", dir, query.filename)
    };

    let vfs = state.sources.ensure_vfs(&source_id).await.map_err(err404)?;

    let mut file_bytes: Option<Vec<u8>> = None;
    if let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| err400(format!("multipart error: {e}")))?
    {
        let bytes = field
            .bytes()
            .await
            .map_err(|e| err400(format!("read multipart field: {e}")))?;
        file_bytes = Some(bytes.to_vec());
    }

    let bytes = file_bytes.ok_or_else(|| err400("no file in request".into()))?;

    debug!(
        "upload file source={} path={} bytes={}",
        source_id,
        full_path,
        bytes.len()
    );
    vfs.put(std::path::Path::new(&full_path), bytes)
        .await
        .map(|()| ok_empty())
        .map_err(|err| err500(err.to_string()))
}
