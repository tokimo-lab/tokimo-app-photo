//! Cooperative job cancellation infrastructure.

use dashmap::DashMap;
use std::sync::{Arc, RwLock};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CancelReason {
    Suspended,
    Aborted,
    Preempted,
}

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

    pub fn cancel(&self, reason: CancelReason) {
        {
            let mut guard = self.reason.write().unwrap();
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
        *self.reason.read().unwrap()
    }
}

impl Default for JobCancel {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Default, Clone)]
pub struct CancellationRegistry {
    inner: Arc<DashMap<Uuid, JobCancel>>,
}

impl CancellationRegistry {
    pub fn register(&self, job_id: Uuid) -> JobCancel {
        let handle = JobCancel::new();
        self.inner.insert(job_id, handle.clone());
        handle
    }

    pub fn unregister(&self, job_id: Uuid) {
        self.inner.remove(&job_id);
    }

    pub fn cancel_one(&self, id: Uuid, reason: CancelReason) -> bool {
        match self.inner.get(&id) {
            Some(h) => {
                h.cancel(reason);
                true
            }
            None => false,
        }
    }
}

pub const PREEMPT_REASON: &str = "superseded by a newer scan";

pub fn check_cancel(cancel: &JobCancel) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if cancel.is_cancelled() {
        return Err("job cancelled".into());
    }
    Ok(())
}
