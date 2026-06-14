//! Handlers for photo image / live-video streaming.

use std::{path::Path as StdPath, sync::Arc};

use axum::{
    body::Body,
    extract::{Path, Query, Request, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use tokimo_package_image::vips::{self, OutputFormat};

use crate::ctx::AppCtx;
use crate::db::repos::photo_repo::PhotoRepo;

/// Returns a simple MIME type for a file path extension.
#[allow(clippy::case_sensitive_file_extension_comparisons)]
fn mime_for_ext(path: &str) -> &'static str {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_lowercase)
        .unwrap_or_default();
    match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "heic" | "heif" => "image/heic",
        "avif" => "image/avif",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        _ => "application/octet-stream",
    }
}

#[derive(Debug, Deserialize)]
pub struct ImageQuery {
    pub format: Option<String>,
}

/// Returns `true` when the file is HEIC/HEIF by MIME type or extension.
fn is_heic_file(path: &str, mime_type: Option<&str>) -> bool {
    if let Some(mime) = mime_type {
        let m = mime.to_lowercase();
        if m == "image/heif" || m == "image/heic" {
            return true;
        }
    }
    let lower = path.to_lowercase();
    lower.ends_with(".heic") || lower.ends_with(".heif")
}

pub async fn serve_photo_image(
    State(ctx): State<Arc<AppCtx>>,
    Path(photo_id): Path<String>,
    Query(q): Query<ImageQuery>,
    request: Request,
) -> Response {
    let Ok(uid) = photo_id.parse::<uuid::Uuid>() else {
        return (StatusCode::BAD_REQUEST, "invalid photo id").into_response();
    };
    let target = match PhotoRepo::load_stream_target(&ctx.db, uid).await {
        Ok(Some(t)) => t,
        Ok(None) => {
            return (StatusCode::NOT_FOUND, "Photo not found").into_response();
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("photo lookup failed: {e}"),
            )
                .into_response();
        }
    };

    // Convert HEIC→JPEG on demand (fallback for browsers without native HEIC support)
    if q.format.as_deref() == Some("jpeg")
        && is_heic_file(&target.path, target.mime_type.as_deref())
    {
        return serve_heic_as_jpeg(&ctx, &target).await;
    }

    serve_file_response(
        &ctx,
        &target.path,
        target.mime_type.as_deref(),
        target.source_id.as_deref(),
        request,
    )
    .await
}

pub async fn serve_live_video(
    State(ctx): State<Arc<AppCtx>>,
    Path(photo_id): Path<String>,
    request: Request,
) -> Response {
    let Ok(uid) = photo_id.parse::<uuid::Uuid>() else {
        return (StatusCode::BAD_REQUEST, "invalid photo id").into_response();
    };
    let target = match PhotoRepo::load_stream_target(&ctx.db, uid).await {
        Ok(Some(t)) => t,
        Ok(None) => {
            return (StatusCode::NOT_FOUND, "Photo not found").into_response();
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("photo lookup failed: {e}"),
            )
                .into_response();
        }
    };

    let Some(live_path) = target.live_video_path else {
        return (StatusCode::NOT_FOUND, "No live video for this photo").into_response();
    };

    serve_file_response(
        &ctx,
        &live_path,
        Some("video/mp4"),
        target.source_id.as_deref(),
        request,
    )
    .await
}

/// Load raw bytes of a photo from local filesystem or remote VFS.
async fn load_photo_bytes(
    ctx: &AppCtx,
    path: &str,
    source_id: Option<&str>,
) -> Result<Vec<u8>, String> {
    match source_id {
        None => tokio::fs::read(StdPath::new(path))
            .await
            .map_err(|e| format!("failed to read local file: {e}")),
        Some(sid) => {
            let vfs = ctx
                .sources
                .ensure_vfs(sid)
                .await
                .map_err(|e| format!("VFS init failed: {e}"))?;
            vfs.read_bytes(StdPath::new(path), 0, None)
                .await
                .map_err(|e| format!("VFS read failed: {e}"))
        }
    }
}

/// Serve a HEIC/HEIF photo by converting it to JPEG on-the-fly via libvips.
async fn serve_heic_as_jpeg(ctx: &AppCtx, target: &crate::models::PhotoStreamTarget) -> Response {
    let raw_bytes = match load_photo_bytes(ctx, &target.path, target.source_id.as_deref()).await {
        Ok(b) => b,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to load HEIC file: {e}"),
            )
                .into_response();
        }
    };

    // Use libvips to decode HEIC and re-encode as JPEG (full size, quality 82).
    let jpeg_bytes = match vips::thumbnail_to_format(&raw_bytes, 0, 0, OutputFormat::Jpeg) {
        Ok(b) => b,
        Err(e) => {
            tracing::warn!("[photo] HEIC→JPEG conversion failed, serving raw: {e}");
            // Fall back to serving the raw HEIC file
            return Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "image/heic")
                .header(header::CACHE_CONTROL, "public, max-age=86400")
                .header(header::CONTENT_LENGTH, raw_bytes.len().to_string())
                .body(Body::from(raw_bytes))
                .unwrap_or_else(|_| Response::new(Body::empty()));
        }
    };

    tracing::info!(
        "[photo] HEIC→JPEG: {} ({} KB → {} KB)",
        target.path,
        raw_bytes.len() / 1024,
        jpeg_bytes.len() / 1024
    );

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "image/jpeg")
        .header(header::CACHE_CONTROL, "public, max-age=86400")
        .header(header::CONTENT_LENGTH, jpeg_bytes.len().to_string())
        .body(Body::from(jpeg_bytes))
        .unwrap_or_else(|_| Response::new(Body::empty()))
}

async fn serve_file_response(
    ctx: &AppCtx,
    path: &str,
    mime_type: Option<&str>,
    source_id: Option<&str>,
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
            let vfs = match ctx.sources.ensure_vfs(sid).await {
                Ok(v) => v,
                Err(e) => {
                    return (StatusCode::BAD_GATEWAY, format!("VFS init failed: {e}"))
                        .into_response();
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
