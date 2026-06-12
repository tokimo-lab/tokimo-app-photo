//! Shared utilities for local filesystem path resolution.

use crate::db::entities::vfs;

/// Resolve a VFS-relative path to an absolute OS path using the source config.
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

/// Get the local driver root directory (internal Unix style) for a VFS model.
#[must_use]
pub fn local_driver_root(fs: &vfs::Model) -> Option<String> {
    if fs.r#type != "local" {
        return None;
    }
    fs.config
        .as_ref()
        .and_then(|c| c.get("root_folder_path"))
        .and_then(|v| v.as_str())
        .map(|s| s.trim_end_matches('/').to_string())
        .filter(|s| !s.is_empty())
}
