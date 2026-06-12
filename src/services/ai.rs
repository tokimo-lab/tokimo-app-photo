//! AI cancel scope — tracks cancellation for AI processing tasks.

use std::sync::Arc;

/// Scope for cancelling an AI processing task.
pub struct AiCancelScope {
    cancelled: bool,
    request_id: Option<String>,
}

impl AiCancelScope {
    /// Start a new cancel scope for a photo AI task.
    pub fn start(_ai_registry: &Arc<AiRegistry>, _photo_id: uuid::Uuid) -> Self {
        Self {
            cancelled: false,
            request_id: None,
        }
    }

    /// Check if this scope has been cancelled.
    pub fn is_cancelled(&self) -> bool {
        self.cancelled
    }

    /// Get the request ID for this scope.
    pub fn request_id_owned(&self) -> Option<String> {
        self.request_id.clone()
    }
}

/// Registry for tracking active AI tasks (stub).
#[derive(Default)]
pub struct AiRegistry;
