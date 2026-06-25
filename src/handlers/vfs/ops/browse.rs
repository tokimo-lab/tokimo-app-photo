use crate::db::datetime::ApiDateTimeExt;
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
};
use futures_util::future::join_all;
use std::{collections::HashMap, path::Path as StdPath, sync::Arc};
use tokimo_vfs::Vfs;
use tracing::debug;

use crate::AppState;
use crate::handlers::{ApiResponse, err400, err404, err500, ok};
use crate::services::source::normalize_source_path;
use tokimo_package_utils::path::{
    internal_to_native, list_roots, native_to_internal, normalize_local_path,
};

use super::types::{
    BrowseBatchRequest, BrowseDirectoryResponse, BrowseEntry, PathQuery, SourceStatEntry,
    StatEntriesRequest,
};

/// Browse the local filesystem directly (no source / VFS).
///
/// 内部格式始终为 Unix 风格（`/` 分隔）。Windows 上盘符映射为 `/c`、`/d`。
/// 当 `path` 为 `/` 或空时，Windows 返回盘符列表，Linux 列出根目录。
pub async fn browse_local(
    Query(query): Query<PathQuery>,
) -> Result<
    Json<ApiResponse<BrowseDirectoryResponse>>,
    (StatusCode, Json<ApiResponse<BrowseDirectoryResponse>>),
> {
    let path_str = query.path.trim();
    if path_str.is_empty() || path_str == "/" {
        if cfg!(windows) {
            let entries = list_roots()
                .into_iter()
                .map(|root| BrowseEntry {
                    name: root.trim_start_matches('/').to_string(),
                    path: root,
                    is_directory: true,
                    size: None,
                    modified_at: None,
                })
                .collect();
            return Ok(ok(BrowseDirectoryResponse {
                current_path: "/".to_string(),
                parent_path: None,
                entries,
            }));
        }
        // Linux: list actual root directory
        debug!("browse local path=/");
        return Ok(ok(list_local_directory("/").await.map_err(err500)?));
    }
    let path = normalize_local_path(path_str).map_err(|e| err400(e.to_string()))?;
    debug!("browse local path={}", path);
    Ok(ok(list_local_directory(&path).await.map_err(err500)?))
}

/// Stat local filesystem entries (no source / VFS).
pub async fn stat_local(
    Json(body): Json<StatEntriesRequest>,
) -> Result<
    Json<ApiResponse<Vec<SourceStatEntry>>>,
    (StatusCode, Json<ApiResponse<Vec<SourceStatEntry>>>),
> {
    let mut stats = Vec::with_capacity(body.paths.len());
    for raw_path in body.paths {
        let Ok(path) = normalize_local_path(&raw_path) else {
            stats.push(SourceStatEntry {
                path: raw_path,
                size: None,
                modified_at: None,
                mode: None,
            });
            continue;
        };
        let native = internal_to_native(&path);
        match tokio::fs::metadata(&native).await {
            Ok(meta) => stats.push(SourceStatEntry {
                path,
                size: if meta.is_dir() {
                    None
                } else {
                    Some(meta.len())
                },
                modified_at: meta
                    .modified()
                    .ok()
                    .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_api_datetime()),
                mode: None,
            }),
            Err(_) => stats.push(SourceStatEntry {
                path,
                size: None,
                modified_at: None,
                mode: None,
            }),
        }
    }
    Ok(ok(stats))
}

pub async fn browse_vfs(
    State(state): State<Arc<AppState>>,
    Path(source_id): Path<String>,
    Query(query): Query<PathQuery>,
) -> Result<
    Json<ApiResponse<BrowseDirectoryResponse>>,
    (StatusCode, Json<ApiResponse<BrowseDirectoryResponse>>),
> {
    let path = normalize_source_path(&query.path).map_err(err400)?;
    let vfs = state.sources.ensure_vfs(&source_id).await.map_err(err404)?;
    debug!("browse source={} path={}", source_id, path);

    Ok(ok(list_directory(&vfs, &path).await.map_err(err500)?))
}

pub async fn browse_vfs_batch(
    State(state): State<Arc<AppState>>,
    Path(source_id): Path<String>,
    Json(body): Json<BrowseBatchRequest>,
) -> Result<
    Json<ApiResponse<Vec<BrowseDirectoryResponse>>>,
    (StatusCode, Json<ApiResponse<Vec<BrowseDirectoryResponse>>>),
> {
    let vfs = state.sources.ensure_vfs(&source_id).await.map_err(err404)?;
    debug!(
        "browse batch source={} dirs={}",
        source_id,
        body.paths.len()
    );

    let paths: Vec<String> = body
        .paths
        .iter()
        .map(|raw| normalize_source_path(raw))
        .collect::<Result<_, _>>()
        .map_err(err400)?;

    let futs = paths.iter().map(|p| list_directory(&vfs, p));
    let results: Vec<BrowseDirectoryResponse> = join_all(futs)
        .await
        .into_iter()
        .collect::<Result<_, _>>()
        .map_err(err500)?;

    Ok(ok(results))
}

pub async fn stat_vfs(
    State(state): State<Arc<AppState>>,
    Path(source_id): Path<String>,
    Json(body): Json<StatEntriesRequest>,
) -> Result<
    Json<ApiResponse<Vec<SourceStatEntry>>>,
    (StatusCode, Json<ApiResponse<Vec<SourceStatEntry>>>),
> {
    let vfs = state.sources.ensure_vfs(&source_id).await.map_err(err404)?;
    let mut listed_entries: HashMap<String, SourceStatEntry> = HashMap::new();
    let mut listed_dirs: HashMap<String, bool> = HashMap::new();
    let mut stats = Vec::with_capacity(body.paths.len());

    for raw_path in body.paths {
        let Ok(path) = normalize_source_path(&raw_path) else {
            stats.push(SourceStatEntry {
                path: raw_path,
                size: None,
                modified_at: None,
                mode: None,
            });
            continue;
        };

        let parent = parent_path(&path).unwrap_or_else(|| "/".to_string());
        if !listed_dirs.contains_key(&parent) {
            listed_dirs.insert(parent.clone(), true);
            if let Ok(entries) = vfs.list(StdPath::new(&parent)).await {
                for entry in entries {
                    if let Ok(entry_path) = normalize_source_path(&entry.path) {
                        listed_entries.insert(
                            entry_path.clone(),
                            SourceStatEntry {
                                path: entry_path,
                                size: if entry.is_dir { None } else { Some(entry.size) },
                                modified_at: entry.modified.to_api_datetime(),
                                mode: None,
                            },
                        );
                    }
                }
            }
        }

        if let Some(entry) = listed_entries.get(&path) {
            stats.push(SourceStatEntry {
                path: entry.path.clone(),
                size: entry.size,
                modified_at: entry.modified_at.clone(),
                mode: None,
            });
            continue;
        }

        match vfs.stat(StdPath::new(&path)).await {
            Ok(info) => stats.push(SourceStatEntry {
                path,
                size: if info.is_dir { None } else { Some(info.size) },
                modified_at: info.modified.to_api_datetime(),
                mode: None,
            }),
            Err(_) => stats.push(SourceStatEntry {
                path,
                size: None,
                modified_at: None,
                mode: None,
            }),
        }
    }

    Ok(ok(stats))
}

fn parent_path(path: &str) -> Option<String> {
    if path == "/" {
        return None;
    }
    let trimmed = path.trim_end_matches('/');
    let idx = trimmed.rfind('/').unwrap_or(0);
    if idx == 0 {
        Some("/".into())
    } else {
        Some(trimmed[..idx].to_string())
    }
}

async fn list_directory(vfs: &Arc<Vfs>, path: &str) -> Result<BrowseDirectoryResponse, String> {
    let entries = vfs
        .list(StdPath::new(path))
        .await
        .map_err(|err| err.to_string())?;
    let mut mapped_entries: Vec<BrowseEntry> = entries
        .into_iter()
        .map(|entry| BrowseEntry {
            name: entry.name,
            path: entry.path,
            is_directory: entry.is_dir,
            size: if entry.is_dir { None } else { Some(entry.size) },
            modified_at: entry.modified.to_api_datetime(),
        })
        .collect();

    mapped_entries.sort_by(|a, b| match (a.is_directory, b.is_directory) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.cmp(&b.name),
    });

    Ok(BrowseDirectoryResponse {
        current_path: path.to_string(),
        parent_path: parent_path(path),
        entries: mapped_entries,
    })
}

async fn list_local_directory(internal_path: &str) -> Result<BrowseDirectoryResponse, String> {
    let native = internal_to_native(internal_path);
    let dir = StdPath::new(&native);
    let mut read_dir = tokio::fs::read_dir(dir).await.map_err(|e| e.to_string())?;
    let mut entries = Vec::new();
    while let Some(entry) = read_dir.next_entry().await.map_err(|e| e.to_string())? {
        let name = entry.file_name().to_string_lossy().to_string();
        let metadata = entry.metadata().await.map_err(|e| e.to_string())?;
        let is_dir = metadata.is_dir();
        let entry_path = native_to_internal(&entry.path().to_string_lossy());
        entries.push(BrowseEntry {
            name,
            path: entry_path,
            is_directory: is_dir,
            size: if is_dir { None } else { Some(metadata.len()) },
            modified_at: metadata.modified().ok().and_then(|t| {
                chrono::DateTime::<chrono::Utc>::from(t)
                    .to_api_datetime()
                    .into()
            }),
        });
    }
    entries.sort_by(|a, b| match (a.is_directory, b.is_directory) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.cmp(&b.name),
    });
    Ok(BrowseDirectoryResponse {
        current_path: internal_path.to_string(),
        parent_path: parent_local_path(internal_path),
        entries,
    })
}

/// 计算内部格式路径的父目录。
///
/// 到达根（`/` 或 `/c` 等盘符根）时返回 `None` 或 `"/"`，让 UI 退回根浏览。
fn parent_local_path(path: &str) -> Option<String> {
    if path.is_empty() || path == "/" {
        return None;
    }
    let trimmed = path.trim_end_matches('/');
    match trimmed.rfind('/') {
        Some(0) => Some("/".to_string()),              // /c -> /
        Some(idx) => Some(trimmed[..idx].to_string()), // /c/Users -> /c
        None => None,
    }
}
