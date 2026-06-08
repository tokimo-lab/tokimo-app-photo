use std::{
    collections::HashMap,
    path::Path,
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

/// Get the local driver root from a VFS entity's config JSON.
///
/// Returns `None` for non-local drivers or if `root` is missing.
#[must_use]
pub fn local_driver_root(source: &crate::db::entities::vfs::Model) -> Option<String> {
    let json = source.config.clone()?;
    let config: serde_json::Value = serde_json::from_value(json).ok()?;
    config
        .get("root")?
        .as_str()
        .map(|s| s.trim_end_matches('/').to_string())
        .filter(|s| !s.is_empty())
}

/// Convert an absolute `root_path` from `photo_libraries.sources` to a VFS-relative path.
///
/// For local sources the DB may store the full filesystem path
/// (e.g. `/home/user/photos/vacation`) while the local driver's root is already
/// `/home/user/photos`. The VFS expects a path relative to the driver root
/// (e.g. `/vacation`), so we strip the driver root prefix.
pub fn to_vfs_path(root_path: &str, source: &crate::db::entities::vfs::Model) -> String {
    let Some(driver_root) = local_driver_root(source) else {
        return root_path.to_string();
    };
    if root_path.starts_with(&driver_root) && root_path.len() > driver_root.len() {
        let rel = &root_path[driver_root.len()..];
        if rel.starts_with('/') {
            return rel.to_string();
        }
    }
    if root_path == driver_root {
        return "/".to_string();
    }
    root_path.to_string()
}

/// Normalize a source path to a VFS-relative absolute path.
///
/// Strips `.` components, rejects `..` traversal, ensures a leading `/`.
pub fn normalize_source_path(path: &str) -> Result<String, String> {
    let trimmed = path.trim();
    let normalized = if trimmed.is_empty() { "/" } else { trimmed };
    let path = Path::new(normalized);
    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            std::path::Component::RootDir | std::path::Component::CurDir => {}
            std::path::Component::Normal(part) => {
                parts.push(part.to_string_lossy().to_string());
            }
            std::path::Component::ParentDir => {
                return Err("path must not contain parent traversal ('..')".into());
            }
            std::path::Component::Prefix(_) => {
                return Err("path contains an unsupported path prefix".into());
            }
        }
    }
    if parts.is_empty() {
        return Ok("/".into());
    }
    Ok(format!("/{}", parts.join("/")))
}
