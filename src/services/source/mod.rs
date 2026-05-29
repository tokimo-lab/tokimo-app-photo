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

    /// Fetch the raw driver config for a source over the bus.
    pub async fn driver_config(
        &self,
        source_id: Uuid,
    ) -> Result<vfs_client::DriverConfig, AppError> {
        let client = self
            .bus_client
            .get()
            .ok_or_else(|| AppError::Internal("bus client is not ready".to_string()))?;
        vfs_client::get_driver_config(client, vfs_client::photo_caller(), source_id).await
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

/// 取本地数据源的驱动根目录（internal Unix 风格，已 trim 尾部 `/`）。
///
/// - 非 `local` 驱动 → `None`
/// - 缺少 `config.root_folder_path` 或为空 → `None`
///
/// 用于：构建 base_path 缓存、把 DB 里存的完整路径反推成 VFS 相对路径。
/// **不要**直接喂给 OS 文件 API；如需原生路径，使用 [`resolve_local_path`]。
#[must_use]
pub fn local_driver_root_from_config(cfg: &vfs_client::DriverConfig) -> Option<String> {
    if cfg.driver_name != "local" {
        return None;
    }
    cfg.config
        .get("root_folder_path")
        .and_then(|v| v.as_str())
        .map(|s| s.trim_end_matches('/').to_string())
        .filter(|s| !s.is_empty())
}

/// Resolve a VFS-relative path against a local driver's `root_folder_path`,
/// returning an OS-native absolute path suitable for `tokio::fs` / FFmpeg.
#[must_use]
pub fn resolve_local_path(rel_path: &str, config: Option<&serde_json::Value>) -> String {
    let driver_root = config
        .and_then(|c| c.get("root_folder_path"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let combined = if rel_path.starts_with('/') {
        format!("{}{}", driver_root.trim_end_matches('/'), rel_path)
    } else {
        format!("{}/{}", driver_root.trim_end_matches('/'), rel_path)
    };
    tokimo_package_utils::path::internal_to_native(&combined)
}
