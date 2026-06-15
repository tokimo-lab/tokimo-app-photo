pub mod cancellation;
pub mod parent_child;
pub mod priority;

pub use priority::JobPriority;

pub mod photo_clip;
pub mod photo_clip_scan;
pub mod photo_face;
pub mod photo_face_scan;
pub mod photo_geocode;
pub mod photo_geocode_scan;
pub mod photo_ocr;
pub mod photo_ocr_scan;

pub mod photo_clip_single;
pub mod photo_face_single;
pub mod photo_ocr_single;

pub mod handlers;

use serde::Serialize;

use crate::db::models::job::JobOutput;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum AppEvent {
    #[serde(rename = "job_update")]
    JobUpdate { job: Box<JobOutput> },
    #[serde(rename = "app_entity")]
    AppEntityEvent {
        user_id: uuid::Uuid,
        app_id: String,
        kind: String,
        scope: Option<String>,
        payload: serde_json::Value,
    },
}

pub type AppEventSender = tokio::sync::broadcast::Sender<AppEvent>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CancelReason {
    Preempted,
    UserCancelled,
    Timeout,
}

pub const PREEMPT_REASON: &str = "preempted by new scan";
