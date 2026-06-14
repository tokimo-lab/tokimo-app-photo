use std::collections::{HashMap, HashSet};
use std::path::Path as StdPath;
use tokimo_vfs::Vfs;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json as JsonResponse,
};
use serde::Serialize;
use std::sync::Arc;
use tracing::{debug, warn};
use ts_rs::TS;

use crate::AppState;
use crate::handlers::{ApiResponse, err400, err404, ok};
use crate::services::source::normalize_source_path;

use super::types::PathQuery;

const DS_STORE_FILE: &str = ".DS_Store";
/// Max .DS_Store file size we'll read (1 MB). Larger files are likely corrupt
/// or from very large directories; the recursive B-tree parser can overflow the
/// stack on pathological inputs.
const MAX_DS_STORE_SIZE: u64 = 1024 * 1024;
/// Apple Double magic number (big-endian)
const APPLE_DOUBLE_MAGIC: u32 = 0x0005_1607;
/// Apple Double prefix for sidecar files
const APPLE_DOUBLE_PREFIX: &str = "._";
/// Finder Info entry ID in Apple Double format
const ENTRY_ID_FINDER_INFO: u32 = 9;
/// Only read the header portion of Apple Double files (enough for Finder Info)
const APPLE_DOUBLE_READ_LIMIT: u64 = 1024;
/// Max number of Apple Double sidecar files to read per directory
const MAX_APPLE_DOUBLE_FILES: usize = 500;

/// Layout metadata read from macOS .DS_Store files.
/// Label colors: 0=None, 1=Gray, 2=Green, 3=Purple, 4=Blue, 5=Yellow, 6=Orange, 7=Red
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DirMeta {
    pub view_mode: Option<String>,
    pub sort_by: Option<String>,
    pub sort_dir: Option<String>,
    /// filename -> macOS Finder label color (0-7)
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub labels: HashMap<String, u8>,
}

// --- DS_Store Parsing ---

fn empty_meta() -> DirMeta {
    DirMeta {
        view_mode: None,
        sort_by: None,
        sort_dir: None,
        labels: HashMap::new(),
    }
}

fn parse_ds_store(data: &[u8]) -> DirMeta {
    match parse_ds_store_inner(data) {
        Some(meta) => meta,
        None => empty_meta(),
    }
}

fn parse_ds_store_inner(data: &[u8]) -> Option<DirMeta> {
    if data.len() < 40 || data[0..4] != [0, 0, 0, 1] {
        return None;
    }

    if &data[4..8] != b"Bud1" {
        return None;
    }
    let info_offset = read_u32(data, 8)? as usize;
    let info_size = read_u32(data, 12)? as usize;
    let info_start = info_offset + 4;
    if info_start + info_size > data.len() {
        return None;
    }

    let mut pos = info_start;
    let num_offsets = read_u32(data, pos)? as usize;
    pos += 4;
    pos += 4;
    if pos + num_offsets * 4 > data.len() {
        return None;
    }
    let mut offsets = Vec::with_capacity(num_offsets);
    for _ in 0..num_offsets {
        offsets.push(read_u32(data, pos)?);
        pos += 4;
    }
    let skip = (256 - (num_offsets % 256)) % 256;
    pos += skip * 4;

    if pos + 4 > data.len() {
        return None;
    }
    let toc_count = read_u32(data, pos)?;
    pos += 4;
    if toc_count != 1 {
        return None;
    }
    pos += 1;
    pos += 4;
    if pos + 4 > data.len() {
        return None;
    }
    let dsdb_block_id = read_u32(data, pos)?;

    let dsdb_block = get_block(data, &offsets, dsdb_block_id)?;
    if dsdb_block.len() < 20 {
        return None;
    }
    let root_node_id = read_u32(dsdb_block, 0)?;

    let mut view_mode: Option<String> = None;
    let mut sort_by: Option<String> = None;

    let mut stack: Vec<(u32, bool)> = vec![(root_node_id, false)];
    let mut visited: HashSet<u32> = HashSet::new();

    const MAX_ITERATIONS: usize = 10_000;
    let mut iterations = 0;

    while let Some((block_id, processed)) = stack.last().copied() {
        iterations += 1;
        if iterations > MAX_ITERATIONS {
            warn!("DS_Store: exceeded max iterations, aborting parse");
            break;
        }
        if view_mode.is_some() && sort_by.is_some() {
            break;
        }

        if !visited.insert(block_id) && !processed {
            warn!("DS_Store: cycle detected at block {}, aborting", block_id);
            break;
        }

        let Some(block) = get_block(data, &offsets, block_id) else {
            stack.pop();
            continue;
        };
        if block.len() < 4 {
            stack.pop();
            continue;
        }
        let pair_count = read_u32(block, 0).unwrap_or(0);

        if pair_count == 0 {
            stack.pop();
            if block.len() < 8 {
                continue;
            }
            let count = read_u32(block, 4).unwrap_or(0) as usize;
            let mut rpos = 8;
            for _ in 0..count.min(1000) {
                if let Some((advance, record_type, record_val)) = read_record(block, rpos) {
                    rpos += advance;
                    apply_record(record_type, &record_val, &mut view_mode, &mut sort_by);
                } else {
                    break;
                }
            }
        } else if !processed {
            stack.last_mut()?.1 = true;

            let pair_count = (pair_count as usize).min(500);
            let mut children_and_records = Vec::new();
            let mut rpos = 4;
            for _ in 0..pair_count {
                if rpos + 4 > block.len() {
                    break;
                }
                let child = read_u32(block, rpos).unwrap_or(0);
                rpos += 4;
                let rec = read_record(block, rpos);
                let advance = rec.as_ref().map_or(0, |(a, _, _)| *a);
                children_and_records.push((child, rec));
                rpos += advance;
            }
            for (child, _) in children_and_records.iter().rev() {
                stack.push((*child, false));
            }
        } else {
            stack.pop();
            let pair_count = (pair_count as usize).min(500);
            let mut rpos = 4;
            for _ in 0..pair_count {
                rpos += 4;
                if let Some((advance, record_type, record_val)) = read_record(block, rpos) {
                    rpos += advance;
                    apply_record(record_type, &record_val, &mut view_mode, &mut sort_by);
                } else {
                    break;
                }
            }
        }
    }

    Some(DirMeta {
        view_mode,
        sort_by,
        sort_dir: None,
        labels: HashMap::new(),
    })
}

fn read_u32(data: &[u8], offset: usize) -> Option<u32> {
    if offset + 4 > data.len() {
        return None;
    }
    Some(u32::from_be_bytes([
        data[offset],
        data[offset + 1],
        data[offset + 2],
        data[offset + 3],
    ]))
}

fn get_block<'a>(data: &'a [u8], offsets: &[u32], block_id: u32) -> Option<&'a [u8]> {
    let address = *offsets.get(block_id as usize)?;
    let offset = (address & !0x1f) as usize;
    let size = 1usize << (address & 0x1f);
    if offset + size > data.len() {
        return None;
    }
    Some(&data[offset..offset + size])
}

fn read_record(block: &[u8], pos: usize) -> Option<(usize, [u8; 4], DsRecordValue)> {
    let mut p = pos;
    let name_len = read_u32(block, p)? as usize;
    p += 4;
    let name_bytes = name_len.checked_mul(2)?;
    if p + name_bytes > block.len() {
        return None;
    }
    p += name_bytes;
    if p + 4 > block.len() {
        return None;
    }
    let rec_type: [u8; 4] = [block[p], block[p + 1], block[p + 2], block[p + 3]];
    p += 4;
    if p + 4 > block.len() {
        return None;
    }
    let data_type: [u8; 4] = [block[p], block[p + 1], block[p + 2], block[p + 3]];
    p += 4;
    let (advance, value) = match &data_type {
        b"long" | b"shor" => {
            if p + 4 > block.len() {
                return None;
            }
            let v = read_u32(block, p)?;
            (4, DsRecordValue::U32(v))
        }
        b"bool" => {
            if p + 1 > block.len() {
                return None;
            }
            (1, DsRecordValue::Bool(()))
        }
        b"blob" => {
            if p + 4 > block.len() {
                return None;
            }
            let blob_len = read_u32(block, p)? as usize;
            p += 4;
            if p + blob_len > block.len() {
                return None;
            }
            (4 + blob_len, DsRecordValue::Blob)
        }
        b"ustr" => {
            if p + 4 > block.len() {
                return None;
            }
            let str_len = read_u32(block, p)? as usize;
            let str_bytes = str_len.checked_mul(2)?;
            if p + 4 + str_bytes > block.len() {
                return None;
            }
            (4 + str_bytes, DsRecordValue::Str)
        }
        b"type" => {
            if p + 4 > block.len() {
                return None;
            }
            let v: [u8; 4] = [block[p], block[p + 1], block[p + 2], block[p + 3]];
            (4, DsRecordValue::FourCC(v))
        }
        b"comp" | b"dutc" => (8.min(block.len() - p), DsRecordValue::Blob),
        _ => {
            return None;
        }
    };
    Some((p + advance - pos, rec_type, value))
}

#[derive(Debug)]
enum DsRecordValue {
    U32(u32),
    Bool(()),
    FourCC([u8; 4]),
    Blob,
    Str,
}

fn apply_record(
    rec_type: [u8; 4],
    value: &DsRecordValue,
    view_mode: &mut Option<String>,
    sort_by: &mut Option<String>,
) {
    match &rec_type {
        b"vstl" => {
            if view_mode.is_none()
                && let DsRecordValue::FourCC(style) = value
            {
                *view_mode = Some(
                    match style {
                        b"Nlsv" | b"clmv" => "list",
                        _ => "grid",
                    }
                    .to_string(),
                );
            }
        }
        b"lsvt" => {
            if sort_by.is_none()
                && let DsRecordValue::U32(v) = value
            {
                *sort_by = Some(
                    match *v as i16 {
                        1 | 2 => "modifiedAt",
                        3 => "size",
                        _ => "name",
                    }
                    .to_string(),
                );
            }
        }
        _ => {}
    }
}

// --- Apple Double (.*) Label Parsing ---

fn parse_apple_double_label(data: &[u8]) -> Option<u8> {
    if data.len() < 26 {
        return None;
    }
    let magic = u32::from_be_bytes([data[0], data[1], data[2], data[3]]);
    if magic != APPLE_DOUBLE_MAGIC {
        return None;
    }
    let num_entries = u16::from_be_bytes([data[24], data[25]]) as usize;
    for i in 0..num_entries {
        let base = 26 + i * 12;
        if base + 12 > data.len() {
            break;
        }
        let entry_id = u32::from_be_bytes([data[base], data[base + 1], data[base + 2], data[base + 3]]);
        let entry_off = u32::from_be_bytes([data[base + 4], data[base + 5], data[base + 6], data[base + 7]]) as usize;
        if entry_id == ENTRY_ID_FINDER_INFO {
            let flags_off = entry_off + 8;
            if flags_off + 2 > data.len() {
                return None;
            }
            let flags = u16::from_be_bytes([data[flags_off], data[flags_off + 1]]);
            let label = ((flags >> 1) & 0x07) as u8;
            return if label > 0 { Some(label) } else { None };
        }
    }
    None
}

async fn collect_labels_from_vfs(vfs: &Arc<Vfs>, dir_path: &str) -> HashMap<String, u8> {
    let mut labels = HashMap::new();
    let Ok(entries) = vfs.list(StdPath::new(dir_path)).await else {
        return labels;
    };
    let mut read_count = 0usize;
    for entry in &entries {
        if !entry.name.starts_with(APPLE_DOUBLE_PREFIX) || entry.is_dir {
            continue;
        }
        if read_count >= MAX_APPLE_DOUBLE_FILES {
            warn!(
                "dir_meta: skipping remaining Apple Double files in {} (read {} already)",
                dir_path, read_count
            );
            break;
        }
        let target_name = &entry.name[APPLE_DOUBLE_PREFIX.len()..];
        if target_name.is_empty() {
            continue;
        }
        let ad_path = StdPath::new(dir_path).join(&entry.name);
        if let Ok(data) = vfs.read_bytes(ad_path.as_ref(), 0, Some(APPLE_DOUBLE_READ_LIMIT)).await
            && let Some(label) = parse_apple_double_label(&data)
        {
            labels.insert(target_name.to_string(), label);
        }
        read_count += 1;
    }
    labels
}

async fn collect_labels_from_local(dir_path: &str) -> HashMap<String, u8> {
    let mut labels = HashMap::new();
    let dir = StdPath::new(dir_path);
    let Ok(mut read_dir) = tokio::fs::read_dir(dir).await else {
        return labels;
    };
    let mut read_count = 0usize;
    while let Ok(Some(entry)) = read_dir.next_entry().await {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.starts_with(APPLE_DOUBLE_PREFIX) {
            continue;
        }
        if read_count >= MAX_APPLE_DOUBLE_FILES {
            warn!(
                "dir_meta: skipping remaining Apple Double files in {} (read {} already)",
                dir_path, read_count
            );
            break;
        }
        let target_name = &name[APPLE_DOUBLE_PREFIX.len()..];
        if target_name.is_empty() {
            continue;
        }
        if let Ok(file) = tokio::fs::File::open(entry.path()).await {
            use tokio::io::AsyncReadExt;
            let mut buf = vec![0u8; APPLE_DOUBLE_READ_LIMIT as usize];
            let mut reader = file;
            let Ok(n) = reader.read(&mut buf).await else {
                continue;
            };
            if let Some(label) = parse_apple_double_label(&buf[..n]) {
                labels.insert(target_name.to_string(), label);
            }
        }
        read_count += 1;
    }
    labels
}

// --- Handlers ---

pub async fn read_local_dir_meta(
    Query(query): Query<PathQuery>,
) -> Result<JsonResponse<ApiResponse<DirMeta>>, (StatusCode, JsonResponse<ApiResponse<DirMeta>>)> {
    let path = normalize_source_path(&query.path).map_err(err400)?;
    debug!("read local dir-meta path={}", path);

    let ds_path = StdPath::new(&path).join(DS_STORE_FILE);
    let mut meta = match tokio::fs::read(&ds_path).await {
        Ok(data) if data.len() <= MAX_DS_STORE_SIZE as usize => parse_ds_store(&data),
        Ok(data) => {
            warn!(
                "dir_meta: .DS_Store too large ({} bytes), skipping: {}",
                data.len(),
                ds_path.display()
            );
            empty_meta()
        }
        Err(_) => empty_meta(),
    };
    meta.labels = collect_labels_from_local(&path).await;

    Ok(ok(meta))
}

pub async fn read_vfs_dir_meta(
    State(state): State<Arc<AppState>>,
    Path(source_id): Path<String>,
    Query(query): Query<PathQuery>,
) -> Result<JsonResponse<ApiResponse<DirMeta>>, (StatusCode, JsonResponse<ApiResponse<DirMeta>>)> {
    let path = normalize_source_path(&query.path).map_err(err400)?;
    let vfs = state.sources.ensure_vfs(&source_id).await.map_err(err404)?;
    debug!("read dir-meta source={} path={}", source_id, path);

    let ds_path = StdPath::new(&path).join(DS_STORE_FILE);
    let mut meta = match vfs.read_bytes(ds_path.as_ref(), 0, Some(MAX_DS_STORE_SIZE)).await {
        Ok(data) => parse_ds_store(&data),
        Err(_) => empty_meta(),
    };
    meta.labels = collect_labels_from_vfs(&vfs, &path).await;

    Ok(ok(meta))
}
