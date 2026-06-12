pub mod cancellation;
pub mod parent_child;

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

pub use cancellation::{CancelReason, CancellationRegistry, JobCancel, PREEMPT_REASON, check_cancel};

/// Job priority levels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum JobPriority {
    Background = 0,
    #[default]
    Normal = 100,
    UserAction = 1000,
    Urgent = 5000,
}

impl JobPriority {
    pub const fn as_i32(self) -> i32 {
        self as i32
    }
}

/// App-wide event broadcast type (stub — photo app uses direct DB for job status).
#[derive(Debug, Clone)]
pub enum AppEvent {
    JobUpdate { job_id: uuid::Uuid },
}

pub type AppEventSender = tokio::sync::broadcast::Sender<AppEvent>;
