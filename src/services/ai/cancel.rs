//! Bridge between the job queue's cooperative cancel token and the AI
//! worker's `/v1/cancel` RPC.
//!
//! Flow:
//! 1. Queue worker sets a task-local [`CurrentJobContext`] before invoking a
//!    handler. The context carries the job id and its [`JobCancel`] handle.
//! 2. Photo (or any future) service that is about to make an AI call spawns
//!    an [`AiCancelScope`] for the current inference unit (e.g. per-photo).
//!    The scope:
//!       - derives a unique `request_id` (`"{job_id}:{unit_id}"`)
//!       - spawns a watcher task that `await`s the job's cancel token and,
//!         when fired, sends a `/v1/cancel {request_id}` RPC to the worker
//!       - aborts the watcher when dropped
//! 3. Worker resolves the `request_id` in its internal registry and calls
//!    `RunOptions::terminate()` on the currently running ONNX session; the
//!    in-flight `run_async` returns an error at the next safe point and
//!    the handler bails out cooperatively.
//!
//! If no [`CurrentJobContext`] is set (e.g. AI is invoked from an HTTP
//! handler outside the queue), [`AiCancelScope::start`] returns `None` and
//! the AI call proceeds without cancellation support — harmless.

#![allow(dead_code)]

use std::sync::Arc;

use tokio::sync::Notify;
use tokio::task::JoinHandle;
use tokio::time::Duration;
use tracing::warn;
use uuid::Uuid;

use crate::queue::cancellation::{JobCancel, current_job};
use tokimo_perception::worker::client::AiWorkerClient;

/// RAII guard bridging `JobCancel` → worker `/v1/cancel`. Construct one
/// around each AI inference unit; drop it after the call returns.
pub struct AiCancelScope {
    request_id: String,
    watcher: Option<JoinHandle<()>>,
    /// Notified on drop so the watcher's 5 s kill-escalation can be aborted
    /// when inference exits cooperatively before the deadline.
    done: Arc<Notify>,
}

impl AiCancelScope {
    /// Start a cancel scope for an AI inference unit keyed by `unit_id`
    /// (typically a photo id). Returns `None` if not currently running
    /// inside a queue handler.
    pub fn start(ai: &Arc<AiWorkerClient>, unit_id: Uuid) -> Option<Self> {
        let ctx = current_job()?;
        let request_id = format!("{}:{}", ctx.job_id, unit_id);
        let done = Arc::new(Notify::new());
        let watcher = spawn_watcher(ai.clone(), ctx.cancel, request_id.clone(), done.clone());
        Some(Self {
            request_id,
            watcher: Some(watcher),
            done,
        })
    }

    /// Opaque id threaded through the AI RPC so the worker can look up the
    /// owning `RunOptions` and call `terminate()` on it.
    pub fn request_id(&self) -> &str {
        &self.request_id
    }

    /// Convenience: clone of the request id suitable for the `Option<String>`
    /// param on AI client methods.
    pub fn request_id_owned(&self) -> String {
        self.request_id.clone()
    }
}

impl Drop for AiCancelScope {
    fn drop(&mut self) {
        // Signal the watcher that inference is done — prevents kill escalation
        // when inference exits cooperatively before the 5 s deadline.
        self.done.notify_waiters();
        if let Some(h) = self.watcher.take() {
            h.abort();
        }
    }
}

fn spawn_watcher(ai: Arc<AiWorkerClient>, cancel: JobCancel, request_id: String, done: Arc<Notify>) -> JoinHandle<()> {
    tokio::spawn(async move {
        // Step 1: wait for the job to be cancelled.
        cancel.token.cancelled().await;

        // Step 2: cooperative cancel RPC — ask ORT to terminate at the next
        // safe point.
        if let Err(e) = ai.cancel(request_id.clone()).await {
            warn!("[ai-cancel] failed to send /v1/cancel for {}: {}", request_id, e);
        }

        // Step 3: if inference hasn't returned within 5 s, hard-kill the worker.
        tokio::select! {
            () = tokio::time::sleep(Duration::from_secs(5)) => {
                warn!("[ai-cancel] inference still running 5s after cancel for {}; killing worker", request_id);
                if let Err(e) = ai.kill_worker().await {
                    warn!("[ai-cancel] kill_worker failed for {}: {}", request_id, e);
                }
            }
            () = done.notified() => {
                // Inference returned cooperatively — no kill needed.
            }
        }
    })
}
