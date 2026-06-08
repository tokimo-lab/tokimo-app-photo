//! VFS directory walk — concurrent BFS with streaming results.

use futures_util::StreamExt;
use futures_util::stream::FuturesUnordered;
use std::{
    collections::VecDeque,
    path::{Path as StdPath, PathBuf},
    sync::Arc,
    time::Instant,
};
use tokimo_vfs::Vfs;
use tokio::sync::mpsc;
use tracing::debug;

use crate::services::source::normalize_source_path;

use super::types::{FileInfo, WalkProgress, WalkStats};

/// Max concurrent `vfs.list()` calls during walk.
const WALK_CONCURRENCY: usize = 8;

/// Walk files matching the given extensions using concurrent BFS, streaming results through `tx`.
///
/// Each discovered file is sent immediately — the caller can start
/// processing while the walk is still in progress.
pub async fn walk_files_streaming(
    vfs: Arc<Vfs>,
    root_path: &str,
    source_id: &str,
    extensions: &'static [&'static str],
    tx: mpsc::Sender<FileInfo>,
) -> Result<WalkStats, String> {
    let mut progress = WalkProgress {
        visited_dirs: 0,
        found_files: 0,
    };
    let mut last_log = Instant::now();

    let mut pending_dirs: VecDeque<PathBuf> = VecDeque::new();
    pending_dirs.push_back(PathBuf::from(root_path));

    let mut in_flight: FuturesUnordered<tokio::task::JoinHandle<Result<ListResult, String>>> =
        FuturesUnordered::new();

    let initial_count = WALK_CONCURRENCY.min(pending_dirs.len());
    for _ in 0..initial_count {
        if let Some(dir) = pending_dirs.pop_front() {
            in_flight.push(spawn_list_dir(vfs.clone(), dir, extensions));
        }
    }

    while !in_flight.is_empty() {
        let join_result = in_flight.next().await.unwrap();
        let list_result = join_result.map_err(|e| e.to_string())??;

        progress.visited_dirs += 1;

        if last_log.elapsed().as_secs() >= 2 {
            debug!(
                "walk progress source={source_id} dirs={} files={} current={}",
                progress.visited_dirs, progress.found_files, list_result.dir_path
            );
            last_log = Instant::now();
        }

        for child_dir in list_result.child_dirs {
            pending_dirs.push_back(child_dir);
        }
        for file in list_result.files {
            progress.found_files += 1;
            if tx.send(file).await.is_err() {
                return Ok(WalkStats {
                    visited_dirs: progress.visited_dirs,
                    found_files: progress.found_files,
                });
            }
        }

        while in_flight.len() < WALK_CONCURRENCY {
            if let Some(dir) = pending_dirs.pop_front() {
                in_flight.push(spawn_list_dir(vfs.clone(), dir, extensions));
            } else {
                break;
            }
        }
    }

    debug!(
        "walk complete source={source_id} dirs={} files={}",
        progress.visited_dirs, progress.found_files
    );

    Ok(WalkStats {
        visited_dirs: progress.visited_dirs,
        found_files: progress.found_files,
    })
}

// ── per-directory listing ───────────────────────────────────────────────

struct ListResult {
    dir_path: String,
    child_dirs: Vec<PathBuf>,
    files: Vec<FileInfo>,
}

fn spawn_list_dir(
    vfs: Arc<Vfs>,
    dir: PathBuf,
    extensions: &'static [&'static str],
) -> tokio::task::JoinHandle<Result<ListResult, String>> {
    tokio::spawn(async move { list_single_dir(&vfs, &dir, extensions).await })
}

async fn list_single_dir(
    vfs: &Vfs,
    dir: &StdPath,
    extensions: &[&str],
) -> Result<ListResult, String> {
    let dir_display = dir.to_string_lossy().to_string();
    let entries = vfs.list(dir).await.map_err(|err| err.to_string())?;
    let visible_entries: Vec<_> = entries
        .into_iter()
        .filter(|entry| !entry.name.starts_with('.'))
        .collect();

    let mut child_dirs = Vec::new();
    let mut files = Vec::new();

    for entry in visible_entries {
        let full_path = normalize_source_path(&entry.path).map_err(|err| err.clone())?;
        if entry.is_dir {
            child_dirs.push(PathBuf::from(&full_path));
            continue;
        }

        let ext = StdPath::new(&entry.name)
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| format!(".{}", value.to_lowercase()))
            .unwrap_or_default();
        if extensions.contains(&ext.as_str()) {
            files.push(FileInfo {
                file_path: full_path,
                dir_path: normalize_source_path(&dir.to_string_lossy())
                    .map_err(|err| err.clone())?,
                file_size: entry.size,
                mtime: entry.modified.map_or(0, |dt| dt.timestamp()),
            });
        }
    }

    Ok(ListResult {
        dir_path: dir_display,
        child_dirs,
        files,
    })
}
