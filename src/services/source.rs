//! Source registry — manages VFS instances for remote filesystem access.

use std::sync::Arc;
use tokimo_vfs::Vfs;
use uuid::Uuid;

use crate::db::entities::vfs as vfs_entity;
use crate::error::AppError;

/// Registry of VFS instances keyed by source ID.
#[derive(Clone)]
pub struct SourceRegistry {
    db: sea_orm::DatabaseConnection,
}

impl SourceRegistry {
    pub fn new(db: sea_orm::DatabaseConnection) -> Self {
        Self { db }
    }

    /// Ensure a VFS instance exists for the given source ID, creating it if needed.
    pub async fn ensure_vfs(&self, source_id: &str) -> Result<Arc<Vfs>, String> {
        let sid: Uuid = source_id.parse().map_err(|_| "invalid source id")?;
        let fs = vfs_entity::Entity::find_by_id(sid)
            .one(&self.db)
            .await
            .map_err(|e| format!("db error: {e}"))?
            .ok_or_else(|| format!("source {source_id} not found"))?;

        let config = fs.config.unwrap_or(serde_json::json!({}));
        let vfs = Vfs::from_config(&fs.r#type, &config)
            .map_err(|e| format!("vfs init failed: {e}"))?;
        Ok(Arc::new(vfs))
    }
}

/// Normalize a source path (remove trailing slashes, ensure leading slash).
pub fn normalize_source_path(path: &str) -> String {
    let trimmed = path.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        "/".to_string()
    } else if !trimmed.starts_with('/') {
        format!("/{trimmed}")
    } else {
        trimmed.to_string()
    }
}
