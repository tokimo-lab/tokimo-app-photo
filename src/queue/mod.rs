//! Photo background job machinery (sidecar port).
//!
//! Job handlers are dispatched from `bus_services::photo_jobs` and run inside
//! a [`cancellation::CurrentJobContext`] scope so that cooperative cancellation
//! (bridged from the bus `jobs.query` status into a local
//! [`cancellation::JobCancel`] token) propagates down to the AI worker.

pub mod cancellation;
pub mod parent_child;
pub mod photo_clip;
pub mod photo_clip_scan;
pub mod photo_clip_single;
pub mod photo_face;
pub mod photo_face_scan;
pub mod photo_face_single;
pub mod photo_geocode;
pub mod photo_geocode_scan;
pub mod photo_ocr;
pub mod photo_ocr_scan;
pub mod photo_ocr_single;
