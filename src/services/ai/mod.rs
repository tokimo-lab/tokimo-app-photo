//! AI service support layer.
//!
//! Currently exposes [`AiCancelScope`]: a RAII helper that bridges the job
//! queue's cooperative cancel token to the AI worker's `/v1/cancel` RPC so
//! that an in-flight ONNX `run_async` call is actually terminated (via
//! `RunOptions::terminate()`) when a user or scheduler cancels the owning
//! job. Without this, cancelling an OCR/CLIP/Face job would leave the
//! worker chewing CPU until the current batch finishes on its own.

pub mod cancel;

pub use cancel::{AiCancelScope, CurrentJobContext, current_job, scope};
