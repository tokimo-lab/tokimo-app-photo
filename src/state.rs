use sea_orm::DatabaseConnection;
use std::collections::HashMap;
use std::sync::{Arc, OnceLock, RwLock};
use tokio::sync::{Notify, broadcast};

use crate::db::models::job::JobOutput;
use crate::queue::{AppEvent, CancelReason, cancellation::JobCancel};

/// Cooperative per-job cancellation registry.
pub struct JobCancelRegistry {
    tokens: RwLock<HashMap<uuid::Uuid, JobCancel>>,
}

impl JobCancelRegistry {
    pub fn new() -> Self {
        Self {
            tokens: RwLock::new(HashMap::new()),
        }
    }

    pub fn register(&self, job_id: uuid::Uuid) -> JobCancel {
        let token = JobCancel::new();
        self.tokens.write().unwrap().insert(job_id, token.clone());
        token
    }

    pub fn cancel_one(&self, job_id: uuid::Uuid, _reason: CancelReason) {
        if let Some(token) = self.tokens.read().unwrap().get(&job_id) {
            token.cancel();
        }
    }

    pub fn remove(&self, job_id: &uuid::Uuid) {
        self.tokens.write().unwrap().remove(job_id);
    }
}

impl Default for JobCancelRegistry {
    fn default() -> Self {
        Self::new()
    }
}

pub struct AppState {
    pub db: DatabaseConnection,
    pub sources: Arc<crate::services::source::SourceRegistry>,
    pub storage: Arc<OnceLock<Arc<dyn crate::services::storage::StorageProvider>>>,
    pub http_client: reqwest::Client,
    pub event_tx: broadcast::Sender<AppEvent>,
    pub job_cancel: JobCancelRegistry,
    pub job_notify: Arc<Notify>,
    pub bus_client: Arc<OnceLock<Arc<tokimo_bus_client::BusClient>>>,
    pub ai: Arc<RwLock<Option<crate::config::PhotoAiSettings>>>,
    pub ai_worker: Arc<OnceLock<Arc<tokimo_perception::worker::client::AiWorkerClient>>>,
}

impl AppState {
    /// Check if OCR is enabled in the current AI settings.
    pub fn is_ocr_enabled(&self) -> bool {
        self.ai.read().unwrap().as_ref().is_some_and(|s| s.ocr_enabled)
    }

    /// Check if CLIP is enabled in the current AI settings.
    pub fn is_clip_enabled(&self) -> bool {
        self.ai.read().unwrap().as_ref().is_some_and(|s| s.clip_enabled)
    }

    /// Check if face recognition is enabled in the current AI settings.
    pub fn is_face_enabled(&self) -> bool {
        self.ai.read().unwrap().as_ref().is_some_and(|s| s.face_enabled)
    }

    /// Check if AI models are ready (always true when using remote AI worker).
    pub fn models_ready(&self) -> bool {
        self.ai_worker.get().is_some()
    }

    /// Check if OCR models are ready.
    pub fn ocr_models_ready(&self) -> bool {
        self.ai_worker.get().is_some()
    }

    /// Check if CLIP models are ready.
    pub fn clip_models_ready(&self) -> bool {
        self.ai_worker.get().is_some()
    }

    /// Get a reference to the AI worker client.
    pub fn ai_client(&self) -> &Arc<tokimo_perception::worker::client::AiWorkerClient> {
        self.ai_worker.get().expect("AI worker client not initialized")
    }

    pub fn bus_notify_job(&self, job: &JobOutput) {
        let Some(client) = self.bus_client.get() else { return };
        let Ok(payload) = serde_json::to_vec(&serde_json::json!({
            "jobId":    job.id,
            "appId":    "photo",
            "userId":   job.user_id,
            "title":    job.r#type,
            "status":   job.status,
            "progress": job.progress,
            "metadata": {},
            "parentJobId": job.parent_job_id,
            "startedAt": job.started_at,
            "updatedAt": job.updated_at,
            "finishedAt": job.completed_at,
        })) else {
            return;
        };
        let client = Arc::clone(client);
        tokio::spawn(async move {
            if let Err(e) = client
                .invoke("task_queue", "upsert_job", payload, client.auto_caller("photo"))
                .await
            {
                tracing::warn!(err = %e, "bus_notify_job: failed to upsert job on bus");
            }
        });
    }
}
