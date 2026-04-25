use axum::{
    body::Body,
    extract::{Path, Query, Request, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use bytes::Bytes;
use serde::Deserialize;
use std::{path::Path as StdPath, sync::Arc};
use tower::util::ServiceExt;
use tower_http::services::ServeFile;

use crate::AppState;
use crate::apps::photo::repos::PhotoRepo;
use crate::handlers::media::stream::mime_for;
use crate::handlers::media::utils::resolve_local_path;
use crate::handlers::{err404, err500};

const PHOTO_SERVE_CHUNK_SIZE: usize = 512 * 1024;
const REMOTE_FS_SOURCE_TYPES: [&str; 10] = [
    "smb",
    "nfs",
    "webdav",
    "ftp",
    "sftp",
    "s3",
    "115cloud",
    "aliyundrive",
    "baidu_netdisk",
    "quark",
];

/// Extensions that browsers cannot decode natively.
const BROWSER_INCOMPATIBLE_EXTS: &[&str] = &[
    ".heic", ".heif", ".avif", ".raw", ".cr2", ".cr3", ".nef", ".arw", ".dng", ".orf", ".rw2", ".pef", ".srw", ".raf",
];

fn needs_server_decode(path: &str) -> bool {
    let lower = path.to_lowercase();
    BROWSER_INCOMPATIBLE_EXTS.iter().any(|ext| lower.ends_with(ext))
}

#[derive(Debug, Deserialize)]
pub struct ImageQuery {
    pub format: Option<String>,
}

/// GET /api/apps/photo/{photoId}/image
pub async fn serve_photo_image(
    State(state): State<Arc<AppState>>,
    Path(photo_id): Path<String>,
    Query(q): Query<ImageQuery>,
    request: Request,
) -> Response {
    let db = state.db.clone();
    let target = match PhotoRepo::load_stream_target(&db, &photo_id).await {
        Ok(Some(t)) => t,
        Ok(None) => return err404::<()>("Photo not found".into()).into_response(),
        Err(e) => return err500::<()>(format!("photo lookup failed: {e}")).into_response(),
    };

    if q.format.as_deref() == Some("jpeg") && needs_server_decode(&target.path) {
        return serve_raw_as_jpeg(state, &target).await;
    }

    serve_vfs_file(
        state,
        target.path,
        target.mime_type.as_deref(),
        target.source_id.as_deref(),
        target.source_type.as_deref(),
        target.source_config.as_ref(),
        request,
    )
    .await
}

/// GET /api/apps/photo/{photoId}/live-video
pub async fn serve_live_video(
    State(state): State<Arc<AppState>>,
    Path(photo_id): Path<String>,
    request: Request,
) -> Response {
    let db = state.db.clone();
    let target = match PhotoRepo::load_stream_target(&db, &photo_id).await {
        Ok(Some(t)) => t,
        Ok(None) => return err404::<()>("Photo not found".into()).into_response(),
        Err(e) => return err500::<()>(format!("photo lookup failed: {e}")).into_response(),
    };

    let Some(live_path) = target.live_video_path else {
        return err404::<()>("No live video for this photo".into()).into_response();
    };

    let mime = Some("video/mp4");
    serve_vfs_file(
        state,
        live_path,
        mime,
        target.source_id.as_deref(),
        target.source_type.as_deref(),
        target.source_config.as_ref(),
        request,
    )
    .await
}

/// Load the raw bytes of a photo from local filesystem or remote VFS.
async fn load_photo_bytes(
    state: &Arc<AppState>,
    target: &crate::apps::photo::models::PhotoStreamTarget,
) -> Result<Vec<u8>, String> {
    if target.source_type.as_deref() == Some("local") {
        let abs_path = resolve_local_path(&target.path, target.source_config.as_ref());
        return tokio::fs::read(&abs_path)
            .await
            .map_err(|e| format!("failed to read local file {abs_path}: {e}"));
    }

    let source_id = target
        .source_id
        .as_deref()
        .ok_or_else(|| "no source_id for remote photo".to_string())?;
    let vfs = state
        .sources
        .ensure_vfs(source_id)
        .await
        .map_err(|e| format!("VFS init failed: {e}"))?;
    vfs.read_bytes(StdPath::new(&target.path), 0, None)
        .await
        .map_err(|e| format!("VFS read failed: {e}"))
}

/// Convert raw HEIC/HEIF bytes to JPEG using FFmpeg CLI.
async fn convert_heic_to_jpeg(raw_bytes: &[u8], filename: &str) -> Result<Vec<u8>, String> {
    use std::process::Stdio;
    use uuid::Uuid;

    let ffmpeg_bin = tokimo_package_hls::resolve_ffmpeg_binary();
    let ext = filename.rsplit('.').next().unwrap_or("heic").to_lowercase();
    let tmp_path = std::env::temp_dir().join(format!("tokimo_heic_{}.{}", Uuid::new_v4(), ext));

    tokio::fs::write(&tmp_path, raw_bytes)
        .await
        .map_err(|e| format!("write temp file: {e}"))?;

    let tmp_str = tmp_path.to_string_lossy().to_string();

    let is_heic = ext == "heic" || ext == "heif";
    let mut cmd = tokio::process::Command::new(&ffmpeg_bin);
    cmd.args(["-i", &tmp_str]);
    if is_heic {
        cmd.args(["-filter_complex", "[0:g:0]scale=-1:-1[out]", "-map", "[out]"]);
    } else {
        cmd.args(["-vframes", "1"]);
    }
    cmd.args(["-f", "image2pipe", "-vcodec", "mjpeg", "-q:v", "2", "pipe:1"]);

    let result = cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).output().await;

    let _ = tokio::fs::remove_file(&tmp_path).await;

    let output = result.map_err(|e| format!("ffmpeg spawn error: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffmpeg convert failed for {filename}: {stderr}"));
    }
    if output.stdout.is_empty() {
        return Err(format!("ffmpeg produced no output for {filename}"));
    }

    tracing::info!(
        "[photo] RAW→JPEG: {filename} ({} KB → {} KB)",
        raw_bytes.len() / 1024,
        output.stdout.len() / 1024
    );
    Ok(output.stdout)
}

/// Serve a browser-incompatible photo by converting to JPEG via FFmpeg.
async fn serve_raw_as_jpeg(state: Arc<AppState>, target: &crate::apps::photo::models::PhotoStreamTarget) -> Response {
    let cache_key = format!("photo-jpeg-cache/{}.jpeg", {
        use std::hash::{Hash, Hasher};
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        target.path.hash(&mut hasher);
        hasher.finish()
    });

    if let Ok(bytes) = state.storage.download(&cache_key).await {
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "image/jpeg")
            .header(header::CACHE_CONTROL, "public, max-age=604800, immutable")
            .header(header::CONTENT_LENGTH, bytes.len().to_string())
            .body(Body::from(bytes))
            .unwrap_or_else(|_| Response::new(Body::empty()));
    }

    let raw_bytes = match load_photo_bytes(&state, target).await {
        Ok(b) => b,
        Err(e) => return err500::<()>(format!("failed to load photo: {e}")).into_response(),
    };

    let filename = target.path.rsplit('/').next().unwrap_or(&target.path);
    let jpeg_bytes = match convert_heic_to_jpeg(&raw_bytes, filename).await {
        Ok(b) => b,
        Err(e) => return err500::<()>(format!("image conversion failed: {e}")).into_response(),
    };

    let storage = Arc::clone(&state.storage);
    let key = cache_key.clone();
    let buf = jpeg_bytes.clone();
    tokio::spawn(async move {
        if let Err(e) = storage
            .upload(
                &key,
                Bytes::from(buf),
                Some(crate::services::storage::UploadOptions {
                    content_type: Some("image/jpeg".to_string()),
                }),
            )
            .await
        {
            tracing::warn!("failed to cache JPEG conversion: {e}");
        }
    });

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "image/jpeg")
        .header(header::CACHE_CONTROL, "public, max-age=604800, immutable")
        .header(header::CONTENT_LENGTH, jpeg_bytes.len().to_string())
        .body(Body::from(jpeg_bytes))
        .unwrap_or_else(|_| Response::new(Body::empty()))
}

/// Serve a file from VFS.
async fn serve_vfs_file(
    state: Arc<AppState>,
    path: String,
    mime_type: Option<&str>,
    source_id: Option<&str>,
    source_type: Option<&str>,
    source_config: Option<&serde_json::Value>,
    request: Request,
) -> Response {
    let content_type = mime_type.unwrap_or_else(|| mime_for(&path));

    if source_type == Some("local") {
        let abs_path = resolve_local_path(&path, source_config);
        let response = match ServeFile::new(&abs_path)
            .with_buf_chunk_size(PHOTO_SERVE_CHUNK_SIZE)
            .oneshot(request)
            .await
        {
            Ok(r) => r,
            Err(never) => match never {},
        };
        let mut resp = response.map(Body::new).into_response();
        resp.headers_mut().insert(
            header::CACHE_CONTROL,
            "public, max-age=604800, immutable".parse().unwrap(),
        );
        return resp;
    }

    let Some(source_id) = source_id else {
        return err404::<()>("Photo source not found".into()).into_response();
    };
    if !source_type.is_some_and(|t| REMOTE_FS_SOURCE_TYPES.contains(&t)) {
        return err404::<()>("Photo source not available".into()).into_response();
    }

    let vfs = match state.sources.ensure_vfs(source_id).await {
        Ok(vfs) => vfs,
        Err(err) => return err404::<()>(err).into_response(),
    };

    let file_data = match vfs.read_bytes(StdPath::new(&path), 0, None).await {
        Ok(data) => data,
        Err(err) => return err500::<()>(format!("failed to read photo: {err}")).into_response(),
    };

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, "public, max-age=86400")
        .header(header::CONTENT_LENGTH, file_data.len().to_string())
        .body(Body::from(file_data))
        .unwrap_or_else(|_| Response::new(Body::empty()))
}
