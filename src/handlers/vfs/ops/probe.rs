//! Media file probing via ffprobe.
//!
//! TODO: Port full implementation from monorepo when `url_util` module
//! is added to the photo app's common module.

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
};
use serde::Serialize;
use std::sync::Arc;
use ts_rs::TS;

use crate::AppState;
use crate::handlers::{ApiResponse, err400, err500, ok};
use crate::services::source::normalize_source_path;

use super::types::PathQuery;

#[derive(Debug, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FileProbeResult {
    pub format: FileProbeFormat,
    pub streams: Vec<FileProbeStream>,
    pub chapters: Vec<FileProbeChapter>,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FileProbeFormat {
    pub format_name: String,
    pub format_long_name: String,
    #[ts(type = "number")]
    pub nb_streams: i32,
    pub duration: Option<f64>,
    #[ts(type = "number | null")]
    pub size: Option<i64>,
    #[ts(type = "number | null")]
    pub bit_rate: Option<i64>,
    pub tags: std::collections::BTreeMap<String, String>,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FileProbeStream {
    #[ts(type = "number")]
    pub index: i32,
    pub codec_type: String,
    pub codec_name: String,
    pub codec_long_name: String,
    pub profile: Option<String>,
    #[ts(type = "number | null")]
    pub width: Option<i32>,
    #[ts(type = "number | null")]
    pub height: Option<i32>,
    pub display_aspect_ratio: Option<String>,
    pub pix_fmt: Option<String>,
    pub color_space: Option<String>,
    pub color_transfer: Option<String>,
    pub color_primaries: Option<String>,
    pub color_range: Option<String>,
    pub field_order: Option<String>,
    pub frame_rate: Option<String>,
    #[ts(type = "number | null")]
    pub sample_rate: Option<i32>,
    #[ts(type = "number | null")]
    pub channels: Option<i32>,
    pub channel_layout: Option<String>,
    pub duration: Option<String>,
    pub bit_rate: Option<String>,
    pub tags: std::collections::BTreeMap<String, String>,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FileProbeChapter {
    #[ts(type = "number")]
    pub id: i64,
    pub start_time: String,
    pub end_time: String,
    pub title: Option<String>,
}

fn url_encode(s: &str) -> String {
    let mut encoded = String::with_capacity(s.len() * 3);
    for byte in s.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char);
            }
            _ => {
                use std::fmt::Write;
                write!(encoded, "%{byte:02X}").ok();
            }
        }
    }
    encoded
}

pub async fn probe_vfs_file(
    State(state): State<Arc<AppState>>,
    Path(source_id): Path<String>,
    Query(query): Query<PathQuery>,
) -> Result<Json<ApiResponse<FileProbeResult>>, (StatusCode, Json<ApiResponse<FileProbeResult>>)> {
    let path = normalize_source_path(&query.path).map_err(err400)?;

    state
        .sources
        .ensure_vfs(&source_id)
        .await
        .map_err(|e| err400(e.clone()))?;

    let listen_port = std::env::var("TOKIMO_PORT").unwrap_or_else(|_| "5678".into());
    let stream_url = format!(
        "http://127.0.0.1:{listen_port}/api/file-systems/{}/stream?path={}",
        url_encode(&source_id),
        url_encode(&path),
    );

    tracing::debug!(source_id, path, "Running FFI probe for VFS file");

    let probe = tokio::task::spawn_blocking(move || tokimo_package_ffmpeg::probe_file(&stream_url))
        .await
        .map_err(|e| err500(format!("probe task failed: {e}")))?
        .map_err(|e| err500(format!("ffprobe failed: {e}")))?;

    Ok(ok(convert_probe(probe)))
}

fn convert_probe(info: tokimo_package_ffmpeg::MediaInfo) -> FileProbeResult {
    let duration = {
        let d = info.format.duration_secs();
        if d > 0.0 { Some(d) } else { None }
    };
    let size = info.format.size.parse::<i64>().ok();
    let bit_rate = info.format.bit_rate.parse::<i64>().ok();

    FileProbeResult {
        format: FileProbeFormat {
            format_name: info.format.format_name,
            format_long_name: info.format.format_long_name,
            nb_streams: info.format.nb_streams,
            duration,
            size,
            bit_rate,
            tags: info.format.tags,
        },
        streams: info.streams.into_iter().map(convert_stream).collect(),
        chapters: info.chapters.into_iter().map(convert_chapter).collect(),
    }
}

fn convert_stream(s: tokimo_package_ffmpeg::StreamInfo) -> FileProbeStream {
    let (width, height, dar, pix_fmt, cs, ct, cp, cr, fo, fr) = match &s.video {
        Some(v) => (
            Some(v.width),
            Some(v.height),
            v.display_aspect_ratio.clone(),
            Some(v.pixel_format.clone()),
            v.color_space.clone(),
            v.color_transfer.clone(),
            v.color_primaries.clone(),
            v.color_range.clone(),
            v.field_order.clone(),
            {
                let rate = &s.avg_frame_rate;
                if rate == "0/0" {
                    None
                } else {
                    Some(rate.clone())
                }
            },
        ),
        None => (None, None, None, None, None, None, None, None, None, None),
    };

    let (sample_rate, channels, channel_layout) = match &s.audio {
        Some(a) => (
            a.sample_rate.parse::<i32>().ok(),
            Some(a.channels),
            a.channel_layout.clone(),
        ),
        None => (None, None, None),
    };

    FileProbeStream {
        index: s.index,
        codec_type: s.codec_type,
        codec_name: s.codec_name,
        codec_long_name: s.codec_long_name,
        profile: s.profile,
        width,
        height,
        display_aspect_ratio: dar,
        pix_fmt,
        color_space: cs,
        color_transfer: ct,
        color_primaries: cp,
        color_range: cr,
        field_order: fo,
        frame_rate: fr,
        sample_rate,
        channels,
        channel_layout,
        duration: s.duration,
        bit_rate: s.bit_rate,
        tags: s.tags,
    }
}

fn convert_chapter(c: tokimo_package_ffmpeg::ChapterInfo) -> FileProbeChapter {
    FileProbeChapter {
        id: c.id,
        start_time: c.start_time,
        end_time: c.end_time,
        title: c.tags.get("title").cloned(),
    }
}
