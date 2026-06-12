//! Photo app — notification integration (standalone stub).
//!
//! In the monorepo, notifications go through the notification_center app.
//! In standalone mode, we log notifications instead.

use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};

use dashmap::DashMap;
use serde::Serialize;
use tracing::info;
use uuid::Uuid;

use crate::AppCtx;

const APP_ID: &str = "photo";

pub const CATEGORY_SYNC_COMPLETED: &str = "sync_completed";
pub const CATEGORY_SYNC_FAILED: &str = "sync_failed";
pub const CATEGORY_PROCESSING_PROGRESS: &str = "processing_progress";
pub const CATEGORY_PROCESSING_COMPLETED: &str = "processing_completed";
pub const CATEGORY_PROCESSING_FAILED: &str = "processing_failed";

/// Notification source definition.
#[derive(Debug, Clone, Serialize)]
pub struct SourceDef {
    pub app_id: String,
    pub category_id: String,
    pub label: String,
    pub default_enabled: bool,
    pub default_display_mode: String,
}

/// A notification to send.
#[derive(Debug, Clone, Serialize)]
pub struct Notification {
    pub app_id: String,
    pub category_id: String,
    pub title: String,
    pub body: Option<String>,
    pub level: Option<String>,
    pub action: Option<serde_json::Value>,
    pub dedupe_key: Option<String>,
    pub progress: Option<i32>,
}

pub fn photo_source_defs() -> Vec<SourceDef> {
    vec![
        SourceDef {
            app_id: APP_ID.into(),
            category_id: CATEGORY_SYNC_COMPLETED.into(),
            label: "photo.notifications.syncCompleted".into(),
            default_enabled: true,
            default_display_mode: "toast".into(),
        },
        SourceDef {
            app_id: APP_ID.into(),
            category_id: CATEGORY_SYNC_FAILED.into(),
            label: "photo.notifications.syncFailed".into(),
            default_enabled: true,
            default_display_mode: "toast".into(),
        },
        SourceDef {
            app_id: APP_ID.into(),
            category_id: CATEGORY_PROCESSING_PROGRESS.into(),
            label: "photo.notifications.processingProgress".into(),
            default_enabled: true,
            default_display_mode: "center".into(),
        },
        SourceDef {
            app_id: APP_ID.into(),
            category_id: CATEGORY_PROCESSING_COMPLETED.into(),
            label: "photo.notifications.processingCompleted".into(),
            default_enabled: true,
            default_display_mode: "toast".into(),
        },
        SourceDef {
            app_id: APP_ID.into(),
            category_id: CATEGORY_PROCESSING_FAILED.into(),
            label: "photo.notifications.processingFailed".into(),
            default_enabled: true,
            default_display_mode: "toast".into(),
        },
    ]
}

fn open_photo_action(library_id: Uuid) -> serde_json::Value {
    serde_json::json!({
        "type": "open-window",
        "windowType": "system",
        "metadata": {
            "pageId": "photo",
            "libraryId": library_id.to_string(),
        }
    })
}

/// Log notification (standalone mode — no notification center bus).
fn log_notification(notification: &Notification) {
    info!(
        category = %notification.category_id,
        title = %notification.title,
        body = ?notification.body,
        "photo notification"
    );
}

pub async fn notify_sync_completed(
    _state: &Arc<AppCtx>,
    _user_id: Uuid,
    _library_id: Uuid,
    library_name: &str,
    total_jobs: usize,
) {
    let notification = Notification {
        app_id: APP_ID.into(),
        category_id: CATEGORY_SYNC_COMPLETED.into(),
        title: format!("相册「{library_name}」同步完成"),
        body: if total_jobs > 0 {
            Some(format!("已派发 {total_jobs} 个后台处理任务"))
        } else {
            None
        },
        level: Some("success".into()),
        action: None,
        dedupe_key: None,
        progress: None,
    };
    log_notification(&notification);
}

pub async fn notify_sync_failed(
    _state: &Arc<AppCtx>,
    _user_id: Uuid,
    _library_id: Uuid,
    library_name: &str,
    error: &str,
) {
    let notification = Notification {
        app_id: APP_ID.into(),
        category_id: CATEGORY_SYNC_FAILED.into(),
        title: format!("相册「{library_name}」同步失败"),
        body: Some(error.to_string()),
        level: Some("error".into()),
        action: None,
        dedupe_key: None,
        progress: None,
    };
    log_notification(&notification);
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

const PROGRESS_THROTTLE: Duration = Duration::from_secs(1);
static PROGRESS_THROTTLE_MAP: LazyLock<DashMap<String, Instant>> = LazyLock::new(DashMap::new);

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

pub async fn notify_processing_progress(
    _state: &Arc<AppCtx>,
    _user_id: Uuid,
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
    let notification = Notification {
        app_id: APP_ID.into(),
        category_id: CATEGORY_PROCESSING_PROGRESS.into(),
        title: format!("{label} · {library_name}"),
        body: Some(format!("已处理 {processed} / {total}")),
        level: Some("info".into()),
        action: None,
        dedupe_key: Some(key),
        progress: None,
    };
    log_notification(&notification);
}

pub async fn notify_processing_completed(
    _state: &Arc<AppCtx>,
    _user_id: Uuid,
    library_id: Uuid,
    library_name: &str,
    task_type: &str,
    processed: i64,
) {
    PROGRESS_THROTTLE_MAP.remove(&progress_dedupe_key(library_id, task_type));
    let label = task_label(task_type);
    let notification = Notification {
        app_id: APP_ID.into(),
        category_id: CATEGORY_PROCESSING_COMPLETED.into(),
        title: format!("{label}完成"),
        body: Some(format!("相册「{library_name}」共处理 {processed} 项")),
        level: Some("success".into()),
        action: None,
        dedupe_key: Some(format!("photo:done:{library_id}:{task_type}")),
        progress: Some(100),
    };
    log_notification(&notification);
}

pub async fn notify_processing_failed(
    _state: &Arc<AppCtx>,
    _user_id: Uuid,
    library_id: Uuid,
    library_name: &str,
    task_type: &str,
    error: &str,
) {
    let label = task_label(task_type);
    let notification = Notification {
        app_id: APP_ID.into(),
        category_id: CATEGORY_PROCESSING_FAILED.into(),
        title: format!("{label}失败"),
        body: Some(format!("相册「{library_name}」: {error}")),
        level: Some("error".into()),
        action: None,
        dedupe_key: None,
        progress: None,
    };
    log_notification(&notification);
}

/// Stub: resync in-flight progress after restart.
pub async fn resync_inflight_progress(_state: &Arc<AppCtx>) {
    // In standalone mode, this is a no-op.
}
