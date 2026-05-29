use std::sync::{Arc, OnceLock};

use sea_orm::DatabaseConnection;
use tokimo_bus_client::BusClient;
use tokimo_perception::worker::client::AiWorkerClient;

use crate::services::source::SourceRegistry;

/// Shared application context — passed to all axum handlers via `State<Arc<AppCtx>>`.
pub struct AppCtx {
    pub db: DatabaseConnection,
    /// Filled in after the bus client is built; read via `client()`.
    pub client: Arc<OnceLock<Arc<BusClient>>>,
    pub sources: Arc<SourceRegistry>,
    /// Perception worker client (OCR / CLIP / face inference).
    pub ai: Arc<AiWorkerClient>,
}

impl AppCtx {
    /// Returns the initialised bus client.
    ///
    /// # Panics
    /// Panics if called before the bus client has been registered.
    pub fn client(&self) -> Arc<BusClient> {
        Arc::clone(self.client.get().expect("BusClient not yet initialised"))
    }
}
