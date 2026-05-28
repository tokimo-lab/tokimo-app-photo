use std::{
    collections::HashMap,
    sync::{Arc, OnceLock},
};

use tokimo_bus_client::BusClient;
use tokimo_vfs::{Driver, DriverRegistry, StorageManager, StorageMount, Vfs};
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::{bus_clients::vfs as vfs_client, error::AppError};

pub struct SourceRegistry {
    bus_client: Arc<OnceLock<Arc<BusClient>>>,
    sources: RwLock<HashMap<String, Arc<Vfs>>>,
}

impl SourceRegistry {
    pub fn new(bus_client: Arc<OnceLock<Arc<BusClient>>>) -> Self {
        Self {
            bus_client,
            sources: RwLock::new(HashMap::new()),
        }
    }

    pub async fn ensure_vfs(&self, source_id: &str) -> Result<Arc<Vfs>, AppError> {
        if let Some(vfs) = self.sources.read().await.get(source_id).cloned() {
            return Ok(vfs);
        }

        let source_uuid = Uuid::parse_str(source_id).map_err(|error| {
            AppError::BadRequest(format!("invalid source id {source_id}: {error}"))
        })?;
        let client = self
            .bus_client
            .get()
            .ok_or_else(|| AppError::Internal("bus client is not ready".to_string()))?;
        let config =
            vfs_client::get_driver_config(client, vfs_client::photo_caller(), source_uuid).await?;

        let registry = DriverRegistry::new();
        let driver = registry
            .create(&config.driver_name, &config.config)
            .map_err(|error| {
                AppError::Internal(format!("create VFS driver {}: {error}", config.driver_name))
            })?;
        let driver: Arc<dyn Driver> = Arc::from(driver);
        driver.init().await.map_err(|error| {
            AppError::Internal(format!("init VFS driver {}: {error}", config.driver_name))
        })?;

        let manager = StorageManager::new();
        manager.mount(StorageMount::new("/", driver)).await;
        let vfs = Arc::new(Vfs::new(manager));
        self.sources
            .write()
            .await
            .insert(source_id.to_string(), Arc::clone(&vfs));
        Ok(vfs)
    }
}
