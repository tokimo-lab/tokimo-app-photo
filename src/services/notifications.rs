#![allow(dead_code)]
//! Photo app — notification dispatch via the OS notification center bus service.
//!
//! Preserves the original throttle / dedupe logic from the monolith and sends
//! each notification through `notification_center.notify` on the bus so the
//! user sees real inbox entries (toast + notification panel) instead of
//! tracing-only logs.
//!
//! Dropped relative to presplit (notification-center-only / local-entity-only):
//! `photo_source_defs`, `ensure_registered`, `resync_inflight_progress`.
//! The `state: &Arc<AppState>` plumbing is removed; functions accept a
//! `BusClient` reference that is stored in a module-level `OnceLock` at
//! startup.

use std::sync::{Arc, LazyLock, OnceLock};
use std::time::{Duration, Instant};

use dashmap::DashMap;
use serde::Serialize;
use serde_json::json;
use tokimo_bus_client::BusClient;
use tokimo_bus_protocol::CallerCtx;
use tracing::{info, warn};
use uuid::Uuid;

const APP_ID: &str = "photo";

/// Module-level bus client slot, initialised once from `main` via [`init`].
static BUS_CLIENT: OnceLock<Arc<BusClient>> = OnceLock::new();

/// Called once during startup (after the bus client is built).
pub fn init(client: Arc<BusClient>) {
    BUS_CLIENT
        .set(client)
        .map_err(|_| "notifications::init called twice")
        .ok();
}

/// Try to grab the bus client. Returns `None` before init or if not running
/// inside a tokio runtime (e.g. tests).
fn bus() -> Option<&'static Arc<BusClient>> {
    BUS_CLIENT.get()
}

pub const CATEGORY_SYNC_COMPLETED: &str = "sync_completed";
pub const CATEGORY_SYNC_FAILED: &str = "sync_failed";
pub const CATEGORY_PROCESSING_PROGRESS: &str = "processing_progress";
pub const CATEGORY_PROCESSING_COMPLETED: &str = "processing_completed";
pub const CATEGORY_PROCESSING_FAILED: &str = "processing_failed";

// ─── Bus notification payload ────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NotifyPayload<'a> {
    user_id: &'a str,
    app_id: &'a str,
    category_id: &'a str,
    title: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    body: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    level: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    action: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    dedupe_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    progress: Option<i32>,
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

/// Fire-and-forget: serialize payload and call `notification_center.notify`
/// over the bus.  Errors are logged at `warn` level — notifications are
/// best-effort and must never block or fail the caller.
fn send_notify(payload: NotifyPayload<'_>) {
    let Some(client) = bus() else {
        // Bus not initialised yet (e.g. during early startup).  The tracing
        // log emitted by the caller is the only record.
        return;
    };
    // Serialize before spawning so the borrow doesn't escape.
    let body = match serde_json::to_vec(&payload) {
        Ok(b) => b,
        Err(e) => {
            warn!("notifications: encode failed: {e}");
            return;
        }
    };
    let user_id = payload.user_id.to_string();
    let client = Arc::clone(client);
    tokio::spawn(async move {
        let caller = CallerCtx {
            user_id: Some(user_id),
            request_id: Uuid::new_v4().to_string(),
            workspace: None,
            caller_app_id: Some(APP_ID.to_string()),
        };
        if let Err(e) = client
            .invoke("notification_center", "notify", body, caller)
            .await
        {
            warn!("notifications: bus invoke failed: {e}");
        }
    });
}

// ─── Sync completed / failed ─────────────────────────────────────────────────

/// Notify: photo library sync completed successfully.
pub fn notify_sync_completed(user_id: Uuid, library_id: Uuid, library_name: &str, total_jobs: u64) {
    let action = open_photo_action(library_id);
    let title = format!(
        "相册「{library_name}」同步完成{}",
        if total_jobs > 0 {
            format!("，已派发 {total_jobs} 个后台处理任务")
        } else {
            String::new()
        }
    );
    info!(
        app_id = APP_ID,
        category = CATEGORY_SYNC_COMPLETED,
        %user_id,
        %library_id,
        library_name,
        total_jobs,
        action = %action,
        "{title}"
    );
    send_notify(NotifyPayload {
        user_id: &user_id.to_string(),
        app_id: APP_ID,
        category_id: CATEGORY_SYNC_COMPLETED,
        title: &title,
        body: None,
        level: Some("success"),
        action: Some(action),
        dedupe_key: None,
        progress: None,
    });
}

/// Notify: photo library sync failed.
pub fn notify_sync_failed(user_id: Uuid, library_id: Uuid, library_name: &str, error: &str) {
    let action = open_photo_action(library_id);
    let title = format!("相册「{library_name}」同步失败: {error}");
    info!(
        app_id = APP_ID,
        category = CATEGORY_SYNC_FAILED,
        %user_id,
        %library_id,
        library_name,
        error,
        action = %action,
        "{title}"
    );
    send_notify(NotifyPayload {
        user_id: &user_id.to_string(),
        app_id: APP_ID,
        category_id: CATEGORY_SYNC_FAILED,
        title: &title,
        body: Some(error),
        level: Some("error"),
        action: Some(action),
        dedupe_key: None,
        progress: None,
    });
}

// ─── Processing throttle / dedupe ────────────────────────────────────────────

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

// ─── Processing progress / completed / failed ────────────────────────────────

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
        ((processed as f64 / total as f64) * 100.0)
            .round()
            .clamp(0.0, 100.0) as i32
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
    send_notify(NotifyPayload {
        user_id: &user_id.to_string(),
        app_id: APP_ID,
        category_id: CATEGORY_PROCESSING_PROGRESS,
        title: &format!("{label} · {library_name}: 已处理 {processed} / {total} ({pct}%)"),
        body: None,
        level: Some("info"),
        action: Some(action),
        dedupe_key: Some(key),
        progress: Some(pct),
    });
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
    let title = format!("{label}完成: 相册「{library_name}」共处理 {processed} 项");
    let dedupe_key = format!("photo:done:{library_id}:{task_type}");
    info!(
        app_id = APP_ID,
        category = CATEGORY_PROCESSING_COMPLETED,
        %user_id,
        %library_id,
        library_name,
        task_type,
        dedupe_key = %dedupe_key,
        progress = 100,
        action = %action,
        "{title}"
    );
    send_notify(NotifyPayload {
        user_id: &user_id.to_string(),
        app_id: APP_ID,
        category_id: CATEGORY_PROCESSING_COMPLETED,
        title: &title,
        body: None,
        level: Some("success"),
        action: Some(action),
        dedupe_key: Some(dedupe_key),
        progress: Some(100),
    });
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
    let title = format!("{label}失败: 相册「{library_name}」: {error}");
    info!(
        app_id = APP_ID,
        category = CATEGORY_PROCESSING_FAILED,
        %user_id,
        %library_id,
        library_name,
        task_type,
        error,
        action = %action,
        "{title}"
    );
    send_notify(NotifyPayload {
        user_id: &user_id.to_string(),
        app_id: APP_ID,
        category_id: CATEGORY_PROCESSING_FAILED,
        title: &title,
        body: Some(error),
        level: Some("error"),
        action: Some(action),
        dedupe_key: None,
        progress: None,
    });
}
