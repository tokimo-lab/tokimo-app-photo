use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Json, Response},
};
use std::{path::Path as StdPath, sync::Arc};

use crate::AppState;
use crate::handlers::media::stream::{mime_for, stream_driver_file};
use crate::handlers::{ApiResponse, err400, err404, err500, ok_empty};
use crate::services::source::normalize_source_path;

use super::types::PathQuery;

/// Returns raw file bytes with the appropriate Content-Type header.
pub async fn read_vfs_file(
    State(state): State<Arc<AppState>>,
    Path(source_id): Path<String>,
    Query(query): Query<PathQuery>,
) -> Result<Response, (StatusCode, Json<ApiResponse<()>>)> {
    let path = normalize_source_path(&query.path).map_err(err400)?;
    let vfs = state.sources.ensure_vfs(&source_id).await.map_err(err404)?;
    let data = vfs
        .read_bytes(StdPath::new(&path), 0, None)
        .await
        .map_err(|err| err500(err.to_string()))?;
    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime_for(&path))
        .body(Body::from(data))
        .unwrap_or_else(|_| Response::new(Body::empty())))
}

pub async fn stream_vfs_file(
    State(state): State<Arc<AppState>>,
    Path(source_id): Path<String>,
    Query(query): Query<PathQuery>,
    headers: HeaderMap,
) -> Response {
    let path = match normalize_source_path(&query.path) {
        Ok(path) => path,
        Err(err) => return err400::<()>(err).into_response(),
    };
    let vfs = match state.sources.ensure_vfs(&source_id).await {
        Ok(vfs) => vfs,
        Err(err) => return err404::<()>(err).into_response(),
    };
    stream_driver_file(
        vfs,
        path,
        headers,
        None,
        tokio_util::sync::CancellationToken::new(),
    )
    .await
}

pub async fn stop_hls_session(
    Path(_source_id): Path<String>,
    Query(_query): Query<PathQuery>,
) -> Json<ApiResponse<()>> {
    ok_empty()
}
