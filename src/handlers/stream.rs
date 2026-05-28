//! Handlers for photo image / live-video streaming.

use std::{path::Path as StdPath, sync::Arc};

use axum::{
    body::Body,
    extract::{Path, Request, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::Deserialize;

use crate::ctx::AppCtx;
use crate::db::repos::photo_repo::PhotoRepo;

/// Returns a simple MIME type for a file path extension.
fn mime_for_ext(path: &str) -> &'static str {
    let lower = path.to_lowercase();
    if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg"
    } else if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else if lower.ends_with(".heic") || lower.ends_with(".heif") {
        "image/heic"
    } else if lower.ends_with(".avif") {
        "image/avif"
    } else if lower.ends_with(".mp4") {
        "video/mp4"
    } else if lower.ends_with(".mov") {
        "video/quicktime"
    } else {
        "application/octet-stream"
    }
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct ImageQuery {
    pub format: Option<String>,
}

pub async fn serve_photo_image(
    State(ctx): State<Arc<AppCtx>>,
    Path(photo_id): Path<String>,
    request: Request,
) -> Response {
    let uid = match photo_id.parse::<uuid::Uuid>() {
        Ok(u) => u,
        Err(_) => return (StatusCode::BAD_REQUEST, "invalid photo id").into_response(),
    };
    let target = match PhotoRepo::load_stream_target(&ctx.db, uid).await {
        Ok(Some(t)) => t,
        Ok(None) => {
            return (StatusCode::NOT_FOUND, "Photo not found").into_response();
        }
        Err(e) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, format!("photo lookup failed: {e}"))
                .into_response();
        }
    };

    serve_file_response(&ctx, &target.path, target.mime_type.as_deref(), target.source_id, request).await
}

pub async fn serve_live_video(
    State(ctx): State<Arc<AppCtx>>,
    Path(photo_id): Path<String>,
    request: Request,
) -> Response {
    let uid = match photo_id.parse::<uuid::Uuid>() {
        Ok(u) => u,
        Err(_) => return (StatusCode::BAD_REQUEST, "invalid photo id").into_response(),
    };
    let target = match PhotoRepo::load_stream_target(&ctx.db, uid).await {
        Ok(Some(t)) => t,
        Ok(None) => {
            return (StatusCode::NOT_FOUND, "Photo not found").into_response();
        }
        Err(e) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, format!("photo lookup failed: {e}"))
                .into_response();
        }
    };

    let Some(live_path) = target.live_video_path else {
        return (StatusCode::NOT_FOUND, "No live video for this photo").into_response();
    };

    serve_file_response(&ctx, &live_path, Some("video/mp4"), target.source_id, request).await
}

async fn serve_file_response(
    ctx: &AppCtx,
    path: &str,
    mime_type: Option<&str>,
    source_id: Option<uuid::Uuid>,
    _request: Request,
) -> Response {
    let content_type = mime_type.unwrap_or_else(|| mime_for_ext(path));

    match source_id {
        None => {
            // Local filesystem file
            match tokio::fs::read(StdPath::new(path)).await {
                Ok(data) => Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, content_type)
                    .header(header::CACHE_CONTROL, "public, max-age=86400")
                    .header(header::CONTENT_LENGTH, data.len().to_string())
                    .body(Body::from(data))
                    .unwrap_or_else(|_| Response::new(Body::empty())),
                Err(e) => (StatusCode::NOT_FOUND, format!("file not found: {e}")).into_response(),
            }
        }
        Some(sid) => {
            // Remote VFS
            let vfs = match ctx.sources.ensure_vfs(&sid.to_string()).await {
                Ok(v) => v,
                Err(e) => {
                    return (StatusCode::BAD_GATEWAY, format!("VFS init failed: {e}")).into_response();
                }
            };
            match vfs.read_bytes(StdPath::new(path), 0, None).await {
                Ok(data) => Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, content_type)
                    .header(header::CACHE_CONTROL, "public, max-age=86400")
                    .header(header::CONTENT_LENGTH, data.len().to_string())
                    .body(Body::from(data))
                    .unwrap_or_else(|_| Response::new(Body::empty())),
                Err(e) => {
                    (StatusCode::BAD_GATEWAY, format!("VFS read failed: {e}")).into_response()
                }
            }
        }
    }
}
