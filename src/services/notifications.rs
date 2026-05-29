#![allow(dead_code)]
//! Photo app — async-event notifications.
//!
//! ## DEVIATION FROM PRESPLIT (notification-center → tracing)
//!
//! The presplit host routed these notifications through the project's
//! `notification_center` app (`NotificationCenter::notify` / `register`,
//! `SourceDef`, the `jobs` entity, and per-user `state` plumbing). The
//! standalone photo sidecar has **no** `crate::apps::notification_center`,
//! so every notification-center call is replaced by a structured
//! `tracing::info!` / `warn!` that logs the same semantic information
//! (library, task, counts, action target). The dedupe / throttle logic
//! (`PROGRESS_THROTTLE`, `PROGRESS_THROTTLE_MAP`, `should_throttle_progress`)
//! is preserved verbatim so progress logs stay collapsed to ~1/sec.
//!
//! Dropped relative to presplit (notification-center-only / local-entity-only):
//! `photo_source_defs`, `ensure_registered`, `resync_inflight_progress`.
//! The `state: &Arc<AppState>` plumbing is removed from the kept fns; they
//! retain `user_id`, `library_id`, names and counts.

use std::sync::LazyLock;
use std::time::{Duration, Instant};

use dashmap::DashMap;
use serde_json::json;
use tracing::info;
use uuid::Uuid;

const APP_ID: &str = "photo";

pub const CATEGORY_SYNC_COMPLETED: &str = "sync_completed";
pub const CATEGORY_SYNC_FAILED: &str = "sync_failed";
pub const CATEGORY_PROCESSING_PROGRESS: &str = "processing_progress";
pub const CATEGORY_PROCESSING_COMPLETED: &str = "processing_completed";
pub const CATEGORY_PROCESSING_FAILED: &str = "processing_failed";

fn open_photo_action(library_id: Uuid) -> serde_json::Value {
    json!({
        "type": "open-window",
        "windowType": "system",
        "metadata": {
            "pageId": "photo",
            "libraryId": library_id.to_string(),
        }
    })
}

/// Notify: photo library sync completed successfully.
pub fn notify_sync_completed(user_id: Uuid, library_id: Uuid, library_name: &str, total_jobs: u64) {
    let action = open_photo_action(library_id);
    info!(
        app_id = APP_ID,
        category = CATEGORY_SYNC_COMPLETED,
        %user_id,
        %library_id,
        library_name,
        total_jobs,
        action = %action,
        "相册「{library_name}」同步完成{}",
        if total_jobs > 0 {
            format!("，已派发 {total_jobs} 个后台处理任务")
        } else {
            String::new()
        }
    );
}

/// Notify: photo library sync failed.
pub fn notify_sync_failed(user_id: Uuid, library_id: Uuid, library_name: &str, error: &str) {
    let action = open_photo_action(library_id);
    info!(
        app_id = APP_ID,
        category = CATEGORY_SYNC_FAILED,
        %user_id,
        %library_id,
        library_name,
        error,
        action = %action,
        "相册「{library_name}」同步失败: {error}"
    );
}

fn task_label(task_type: &str) -> &'static str {
    match task_type {
        "photo_ocr" => "OCR 文字识别",
        "photo_clip" => "图像理解",
        "photo_face_detect" => "人脸识别",
        "photo_reverse_geocode" => "地理位置解析",
        _ => "后台处理",
    }
}

fn progress_dedupe_key(library_id: Uuid, task_type: &str) -> String {
    format!("photo:processing:{library_id}:{task_type}")
}

/// Min interval between progress notifications for the same (library, task).
/// At ~100k child jobs, per-child notifications would flood the WS + the
/// notification center; we collapse to ~1/sec.
const PROGRESS_THROTTLE: Duration = Duration::from_secs(1);
static PROGRESS_THROTTLE_MAP: LazyLock<DashMap<String, Instant>> = LazyLock::new(DashMap::new);

/// Returns true if we should skip this progress tick (i.e. throttled).
/// Never throttles the final (processed == total) tick.
fn should_throttle_progress(key: &str, processed: i64, total: i64) -> bool {
    if total > 0 && processed >= total {
        return false;
    }
    let now = Instant::now();
    let entry = PROGRESS_THROTTLE_MAP.entry(key.to_string());
    match entry {
        dashmap::mapref::entry::Entry::Occupied(mut o) => {
            let last = *o.get();
            if now.duration_since(last) < PROGRESS_THROTTLE {
                return true;
            }
            o.insert(now);
            false
        }
        dashmap::mapref::entry::Entry::Vacant(v) => {
            v.insert(now);
            false
        }
    }
}

/// Notify: long-running worker progress. Uses dedupe_key so the same task
/// updates one notification in place rather than spamming a new entry per tick.
pub fn notify_processing_progress(
    user_id: Uuid,
    library_id: Uuid,
    library_name: &str,
    task_type: &str,
    processed: i64,
    total: i64,
) {
    let key = progress_dedupe_key(library_id, task_type);
    if should_throttle_progress(&key, processed, total) {
        return;
    }
    let label = task_label(task_type);
    let pct = if total > 0 {
        ((processed as f64 / total as f64) * 100.0).round().clamp(0.0, 100.0) as i32
    } else {
        0
    };
    let action = open_photo_action(library_id);
    info!(
        app_id = APP_ID,
        category = CATEGORY_PROCESSING_PROGRESS,
        %user_id,
        %library_id,
        library_name,
        task_type,
        dedupe_key = %key,
        progress = pct,
        action = %action,
        "{label} · {library_name}: 已处理 {processed} / {total} ({pct}%)"
    );
}

/// Notify: a worker stage finished successfully. Reuses the progress dedupe
/// key so the in-place progress notification is replaced with the completion.
pub fn notify_processing_completed(
    user_id: Uuid,
    library_id: Uuid,
    library_name: &str,
    task_type: &str,
    processed: i64,
) {
    // Drop any throttle timestamp so a future rerun of this task starts fresh.
    PROGRESS_THROTTLE_MAP.remove(&progress_dedupe_key(library_id, task_type));
    let label = task_label(task_type);
    let action = open_photo_action(library_id);
    info!(
        app_id = APP_ID,
        category = CATEGORY_PROCESSING_COMPLETED,
        %user_id,
        %library_id,
        library_name,
        task_type,
        // Different dedupe_key from progress so user keeps a completion record.
        dedupe_key = %format!("photo:done:{library_id}:{task_type}"),
        progress = 100,
        action = %action,
        "{label}完成: 相册「{library_name}」共处理 {processed} 项"
    );
}

/// Notify: worker stage failed.
pub fn notify_processing_failed(
    user_id: Uuid,
    library_id: Uuid,
    library_name: &str,
    task_type: &str,
    error: &str,
) {
    let label = task_label(task_type);
    let action = open_photo_action(library_id);
    info!(
        app_id = APP_ID,
        category = CATEGORY_PROCESSING_FAILED,
        %user_id,
        %library_id,
        library_name,
        task_type,
        error,
        action = %action,
        "{label}失败: 相册「{library_name}」: {error}"
    );
}
