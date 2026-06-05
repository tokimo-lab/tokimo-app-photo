//! Cooperative job cancellation infrastructure (sidecar port).
//!
//! Like the sibling `bus_clients` modules, this is an infrastructure surface
//! whose public API is wired up incrementally across the AI-service, queue and
//! dispatch commits; `#![allow(dead_code)]` mirrors that precedent. It also
//! intentionally mirrors the host's full `CancelReason` surface even though the
//! sidecar's bus-backed poller currently only ever raises `Aborted`.
//!
//! In the pre-split host, each running job was registered in a process-wide
//! `CancellationRegistry` and the queue worker handed each handler a
//! [`JobCancel`] token that HTTP cancel endpoints could trip directly. In the
//! sidecar there is no in-process registry: cancellation lives in the OS job
//! store and is observed over the bus. The dispatcher therefore:
//!
//! 1. creates a fresh [`JobCancel`] per job,
//! 2. spawns a poller that periodically calls [`is_cancelled`] (bus
//!    `jobs.query`) and trips the token when the OS marks the job
//!    cancelled/cancelling,
//! 3. installs the token as the task-local [`CurrentJobContext`] (via
//!    [`scope`]) so [`crate::services::ai::AiCancelScope`] can bridge it to the
//!    perception worker's `/v1/cancel` RPC.
//!
//! Handlers keep the pre-split shape: they take `cancel: &JobCancel` and call
//! [`check_cancel`] / the [`check_cancel!`] macro, which returns a sentinel
//! marker error when the token has been tripped.

#![allow(dead_code)]

use std::sync::Arc;

use parking_lot::RwLock;
use tokimo_bus_client::BusClient;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::bus_clients::jobs::{self, QueryJobsRequest};

/// Reason why a job's [`CancellationToken`] was triggered.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CancelReason {
    /// User-initiated suspend (job should land in `suspended` status).
    Suspended,
    /// User-initiated abort (job should land in `cancelled` status).
    Aborted,
    /// Job was preempted by a newer scan of the same kind. Lands in
    /// `cancelled` status with a friendly reason ("被新的扫描覆盖").
    Preempted,
}

/// Per-running-job cancellation handle. Cheap to clone (all fields shared).
#[derive(Clone)]
pub struct JobCancel {
    pub token: CancellationToken,
    pub reason: Arc<RwLock<Option<CancelReason>>>,
}

impl JobCancel {
    pub fn new() -> Self {
        Self {
            token: CancellationToken::new(),
            reason: Arc::new(RwLock::new(None)),
        }
    }

    /// Record the reason and trigger the underlying token. Idempotent: only
    /// the first cancel wins; subsequent calls are ignored.
    pub fn cancel(&self, reason: CancelReason) {
        {
            let mut guard = self.reason.write();
            if guard.is_none() {
                *guard = Some(reason);
            }
        }
        self.token.cancel();
    }

    pub fn is_cancelled(&self) -> bool {
        self.token.is_cancelled()
    }

    pub fn reason(&self) -> Option<CancelReason> {
        *self.reason.read()
    }
}

impl Default for JobCancel {
    fn default() -> Self {
        Self::new()
    }
}

/// Sentinel error marker: handler returns this when it observed a `Suspended`
/// cancel and bailed out cooperatively.
pub const CANCEL_MARKER_SUSPENDED: &str = "__TOKIMO_JOB_SUSPENDED__";

/// Sentinel error marker: handler returns this when it observed an `Aborted`
/// cancel.
pub const CANCEL_MARKER_ABORTED: &str = "__TOKIMO_JOB_ABORTED__";

/// Sentinel error marker: handler returns this when it observed a `Preempted`
/// cancel.
pub const CANCEL_MARKER_PREEMPTED: &str = "__TOKIMO_JOB_PREEMPTED__";

/// Friendly Chinese reason displayed in `jobs.error` for preempted jobs.
pub const PREEMPT_REASON: &str = "被新的扫描覆盖";

/// Convenience helper for handlers: if the token has been triggered, return an
/// error containing the appropriate sentinel marker.
pub fn check_cancel(cancel: &JobCancel) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if cancel.is_cancelled() {
        let marker = match cancel.reason() {
            Some(CancelReason::Suspended) => CANCEL_MARKER_SUSPENDED,
            Some(CancelReason::Preempted) => CANCEL_MARKER_PREEMPTED,
            _ => CANCEL_MARKER_ABORTED,
        };
        return Err(marker.into());
    }
    Ok(())
}

/// Bus-backed cancellation probe: returns `true` when the OS job store reports
/// `job_id` as `cancelled`/`cancelling`. Used by the dispatcher's poller to
/// trip the local [`JobCancel`] token.
pub async fn is_cancelled(client: &BusClient, job_id: Uuid) -> bool {
    let req = QueryJobsRequest {
        id: Some(job_id),
        ..Default::default()
    };
    match jobs::query(client, jobs::photo_service_caller(), req).await {
        Ok(resp) => resp
            .items
            .iter()
            .any(|j| matches!(j.status.as_str(), "cancelled" | "cancelling")),
        Err(_) => false,
    }
}

tokio::task_local! {
    /// Task-local job context installed by the dispatcher before invoking a
    /// handler. Read via [`current_job`]; unset outside queue handlers.
    pub static CURRENT_JOB: CurrentJobContext;
}

/// Snapshot of the current job context, carried in a task-local so AI services
/// can spawn cancel scopes without threading the handle through every call.
#[derive(Clone)]
pub struct CurrentJobContext {
    pub job_id: Uuid,
    pub cancel: JobCancel,
}

/// Snapshot of the current job context if the caller is running inside a queue
/// handler; `None` otherwise.
pub fn current_job() -> Option<CurrentJobContext> {
    CURRENT_JOB.try_with(Clone::clone).ok()
}

/// Run `fut` with the given [`CurrentJobContext`] installed as the task-local.
pub async fn scope<F, T>(ctx: CurrentJobContext, fut: F) -> T
where
    F: std::future::Future<Output = T>,
{
    CURRENT_JOB.scope(ctx, fut).await
}

/// Spawn a background poller that trips `cancel` when the OS job store reports
/// `job_id` cancelled. The poller exits once the token fires (either via the
/// store or because the handler completed and the dispatcher dropped its
/// guard). Returns the spawned task handle so the dispatcher can abort it.
pub fn spawn_cancel_poller(
    client: Arc<BusClient>,
    job_id: Uuid,
    cancel: JobCancel,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let poll = std::time::Duration::from_secs(3);
        loop {
            tokio::select! {
                () = cancel.token.cancelled() => break,
                () = tokio::time::sleep(poll) => {
                    if is_cancelled(&client, job_id).await {
                        cancel.cancel(CancelReason::Aborted);
                        break;
                    }
                }
            }
        }
    })
}

/// Handler-side cooperative cancellation check. Mirrors the pre-split macro:
/// returns early with the sentinel marker error when the token is tripped.
#[macro_export]
macro_rules! check_cancel {
    ($cancel:expr) => {
        $crate::queue::cancellation::check_cancel($cancel)?
    };
}
