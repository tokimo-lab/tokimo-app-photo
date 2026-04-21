//! Photo app — notification center integration.
//!
//! Sends async-event notifications (sync completed/failed, processing
//! progress/completed/failed) through the project's notification center.
//! Interactive feedback (e.g. "已收藏 N 张") stays as in-window toast and
//! does NOT go through this module.

use std::sync::Arc;

use serde_json::json;
use tracing::warn;
use uuid::Uuid;

use crate::AppState;
use crate::apps::notification_center::repos::sources::SourceDef;
use crate::apps::notification_center::services::center::{Notification, NotificationCenter};

const APP_ID: &str = "photo";

pub const CATEGORY_SYNC_COMPLETED: &str = "sync_completed";
pub const CATEGORY_SYNC_FAILED: &str = "sync_failed";
pub const CATEGORY_PROCESSING_PROGRESS: &str = "processing_progress";
pub const CATEGORY_PROCESSING_COMPLETED: &str = "processing_completed";
pub const CATEGORY_PROCESSING_FAILED: &str = "processing_failed";

/// Returns the SourceDef list for the photo app's notification categories.
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
            // Progress notifications update in-place via dedupe_key — do not toast each tick.
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

/// Lazy-register photo's notification sources for a user. Idempotent (upsert).
pub async fn ensure_registered(state: &Arc<AppState>, user_id: Uuid) {
    if let Err(e) = NotificationCenter::register(state, user_id, photo_source_defs()).await {
        warn!("Failed to register photo notification sources: {e}");
    }
}

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
pub async fn notify_sync_completed(
    state: &Arc<AppState>,
    user_id: Uuid,
    library_id: Uuid,
    library_name: &str,
    total_jobs: u64,
) {
    ensure_registered(state, user_id).await;
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
        action: Some(open_photo_action(library_id)),
        dedupe_key: None,
        progress: None,
        template_context: None,
    };
    if let Err(e) = NotificationCenter::notify(state, user_id, notification).await {
        warn!("notify_sync_completed failed: {e}");
    }
}

/// Notify: photo library sync failed.
pub async fn notify_sync_failed(
    state: &Arc<AppState>,
    user_id: Uuid,
    library_id: Uuid,
    library_name: &str,
    error: &str,
) {
    ensure_registered(state, user_id).await;
    let notification = Notification {
        app_id: APP_ID.into(),
        category_id: CATEGORY_SYNC_FAILED.into(),
        title: format!("相册「{library_name}」同步失败"),
        body: Some(error.to_string()),
        level: Some("error".into()),
        action: Some(open_photo_action(library_id)),
        dedupe_key: None,
        progress: None,
        template_context: None,
    };
    if let Err(e) = NotificationCenter::notify(state, user_id, notification).await {
        warn!("notify_sync_failed failed: {e}");
    }
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

/// Notify: long-running worker progress. Uses dedupe_key so the same task
/// updates one notification in place rather than spamming a new entry per tick.
pub async fn notify_processing_progress(
    state: &Arc<AppState>,
    user_id: Uuid,
    library_id: Uuid,
    library_name: &str,
    task_type: &str,
    processed: i64,
    total: i64,
) {
    ensure_registered(state, user_id).await;
    let label = task_label(task_type);
    let pct = if total > 0 {
        ((processed as f64 / total as f64) * 100.0).round().clamp(0.0, 100.0) as i32
    } else {
        0
    };
    let notification = Notification {
        app_id: APP_ID.into(),
        category_id: CATEGORY_PROCESSING_PROGRESS.into(),
        title: format!("{label} · {library_name}"),
        body: Some(format!("已处理 {processed} / {total}")),
        level: Some("info".into()),
        action: Some(open_photo_action(library_id)),
        dedupe_key: Some(progress_dedupe_key(library_id, task_type)),
        progress: Some(pct),
        template_context: None,
    };
    if let Err(e) = NotificationCenter::notify(state, user_id, notification).await {
        warn!("notify_processing_progress failed: {e}");
    }
}

/// Notify: a worker stage finished successfully. Reuses the progress dedupe
/// key so the in-place progress notification is replaced with the completion.
pub async fn notify_processing_completed(
    state: &Arc<AppState>,
    user_id: Uuid,
    library_id: Uuid,
    library_name: &str,
    task_type: &str,
    processed: i64,
) {
    ensure_registered(state, user_id).await;
    let label = task_label(task_type);
    let notification = Notification {
        app_id: APP_ID.into(),
        category_id: CATEGORY_PROCESSING_COMPLETED.into(),
        title: format!("{label}完成"),
        body: Some(format!("相册「{library_name}」共处理 {processed} 项")),
        level: Some("success".into()),
        action: Some(open_photo_action(library_id)),
        // Different dedupe_key from progress so user keeps a completion record.
        dedupe_key: Some(format!("photo:done:{library_id}:{task_type}")),
        progress: Some(100),
        template_context: None,
    };
    if let Err(e) = NotificationCenter::notify(state, user_id, notification).await {
        warn!("notify_processing_completed failed: {e}");
    }
}

/// Notify: worker stage failed.
pub async fn notify_processing_failed(
    state: &Arc<AppState>,
    user_id: Uuid,
    library_id: Uuid,
    library_name: &str,
    task_type: &str,
    error: &str,
) {
    ensure_registered(state, user_id).await;
    let label = task_label(task_type);
    let notification = Notification {
        app_id: APP_ID.into(),
        category_id: CATEGORY_PROCESSING_FAILED.into(),
        title: format!("{label}失败"),
        body: Some(format!("相册「{library_name}」: {error}")),
        level: Some("error".into()),
        action: Some(open_photo_action(library_id)),
        dedupe_key: None,
        progress: None,
        template_context: None,
    };
    if let Err(e) = NotificationCenter::notify(state, user_id, notification).await {
        warn!("notify_processing_failed failed: {e}");
    }
}
