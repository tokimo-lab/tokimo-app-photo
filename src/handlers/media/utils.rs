//! Shared utilities for local filesystem path resolution.
//!
//! `resolve_local_path` is used by ffprobe, thumbnail generation, Jellyfin compatibility,
//! photo processing, and other code that must pass a real OS path to external tools (FFmpeg etc.).
//! It is NOT used by the VFS streaming path.
//!
//! **路径格式约定**：
//! - VFS 配置 `root_folder_path` 与 `rel_path` 均为内部 Unix 风格（Linux: `/mnt/x`，
//!   Windows: `/c/Users/x`）。
//! - `resolve_local_path` 输出为 OS 原生路径（Windows 上转换为 `C:\Users\x`），
//!   可直接喂给 `tokio::fs` / FFmpeg / yt-dlp 等。
//! - `local_driver_root` 仅返回**未做 native 转换**的内部 Unix 风格根目录，
//!   适合做字符串前缀比对（如把 DB 里的完整路径反推成 VFS 相对路径）。

use crate::db::entities::vfs;

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

/// 取本地数据源的驱动根目录（internal Unix 风格，已 trim 尾部 `/`）。
///
/// - 非 `local` 类型 → `None`
/// - 缺少 `config.root_folder_path` 或为空 → `None`
///
/// 用于：构建 base_path 缓存、把 DB 里存的完整路径反推成 VFS 相对路径。
/// **不要**直接喂给 OS 文件 API；如需原生路径，使用 [`resolve_local_path`]。
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
