use axum::{
    Json,
    extract::{Path, Query, State},
};
use sea_orm::DatabaseConnection;
use serde::Deserialize;
use std::{path::Path as StdPath, sync::Arc};
use uuid::Uuid;

use crate::AppState;
use crate::repos::PhotoRepo;
use crate::common::thread_util::named_spawn_blocking;
use crate::db::pagination::PageInput;
use crate::error::AppError;
use crate::error::OptionExt;
use crate::handlers::{ApiResponse, ok};
use tracing::warn;

use super::parse_uuid;

/// POST /api/photos/{id}/toggle-favorite
pub async fn toggle_favorite(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let uid = parse_uuid(&id)?;
    let is_favorite = PhotoRepo::toggle_favorite(&state.db, uid).await?;
    Ok(ok(serde_json::json!({ "isFavorite": is_favorite })))
}

pub async fn batch_hide(
    State(ctx): State<Arc<AppCtx>>,
    Path(_id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, AppError> {
    let photo_ids: Vec<String> = body
        .get("photoIds")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    let hidden: bool = body
        .get("hidden")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(true);
    let ids = parse_ids(&photo_ids);
    let count = PhotoRepo::batch_set_hidden(&ctx.db, &ids, hidden).await?;
    ok(serde_json::json!({ "updated": count }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchFavoriteBody {
    pub photo_ids: Vec<String>,
    pub favorite: bool,
}

/// POST /api/apps/photo/{id}/photos/batch-favorite
pub async fn batch_favorite(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(body): Json<BatchFavoriteBody>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let _lib_id = parse_uuid(&id)?;
    let photo_ids: Vec<Uuid> = body.photo_ids.iter().map(|s| parse_uuid(s)).collect::<Result<_, _>>()?;
    let count = PhotoRepo::batch_set_favorite(&state.db, &photo_ids, body.favorite).await?;
    Ok(ok(serde_json::json!({ "updated": count })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchDeleteBody {
    pub photo_ids: Vec<String>,
}

/// POST /api/apps/photo/{id}/photos/batch-delete
pub async fn batch_delete(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(body): Json<BatchDeleteBody>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let lib_id = parse_uuid(&id)?;
    let photo_ids: Vec<Uuid> = body.photo_ids.iter().map(|s| parse_uuid(s)).collect::<Result<_, _>>()?;
    let deleted = PhotoRepo::batch_delete(&state.db, lib_id, &photo_ids).await?;
    Ok(ok(serde_json::json!({ "deleted": deleted })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchHideBody {
    pub photo_ids: Vec<String>,
    pub hidden: bool,
}

/// POST /api/apps/photo/{id}/photos/batch-hide
pub async fn batch_hide(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(body): Json<BatchHideBody>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let _lib_id = parse_uuid(&id)?;
    let photo_ids: Vec<Uuid> = body.photo_ids.iter().map(|s| parse_uuid(s)).collect::<Result<_, _>>()?;
    let count = PhotoRepo::batch_set_hidden(&state.db, &photo_ids, body.hidden).await?;
    Ok(ok(serde_json::json!({ "updated": count })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePhotoBody {
    pub title: Option<String>,
    pub description: Option<String>,
    pub taken_at: Option<String>,
}

/// PATCH /api/photos/{id}
pub async fn update_photo(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(body): Json<UpdatePhotoBody>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let uid = parse_uuid(&id)?;

    let taken_at = match &body.taken_at {
        Some(s) => {
            let dt = chrono::DateTime::parse_from_rfc3339(s)
                .map_err(|_| AppError::BadRequest("invalid takenAt format, expected ISO8601".into()))?;
            Some(Some(dt))
        }
        None => None,
    };

    let photo = PhotoRepo::update_photo(
        &state.db,
        uid,
        body.title.as_ref().map(|t| Some(t.clone())),
        body.description.as_ref().map(|d| Some(d.clone())),
        taken_at,
    )
    .await?;

    Ok(ok(serde_json::to_value(photo).unwrap()))
}

// ─── Trash / Soft Delete ───

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashPhotosBody {
    pub photo_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashListQuery {
    pub page: Option<u64>,
    pub page_size: Option<u64>,
}

/// POST /api/apps/photo/{id}/photos/trash
pub async fn trash_photos(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(body): Json<TrashPhotosBody>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let lib_id = parse_uuid(&id)?;
    let photo_ids: Vec<Uuid> = body.photo_ids.iter().map(|s| parse_uuid(s)).collect::<Result<_, _>>()?;
    let trashed = PhotoRepo::trash_photos(&state.db, lib_id, &photo_ids).await?;
    Ok(ok(serde_json::json!({ "trashed": trashed })))
}

/// POST /api/apps/photo/{id}/photos/restore
pub async fn restore_photos(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(body): Json<TrashPhotosBody>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let lib_id = parse_uuid(&id)?;
    let photo_ids: Vec<Uuid> = body.photo_ids.iter().map(|s| parse_uuid(s)).collect::<Result<_, _>>()?;
    let restored = PhotoRepo::restore_photos(&state.db, lib_id, &photo_ids).await?;
    Ok(ok(serde_json::json!({ "restored": restored })))
}

/// GET /api/apps/photo/{id}/photos/trash
pub async fn list_trashed(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(q): Query<TrashListQuery>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let uid = parse_uuid(&id)?;
    let page_input = PageInput {
        page: q.page.unwrap_or(1),
        page_size: q.page_size.unwrap_or(60),
    };
    let result = PhotoRepo::list_trashed(&state.db, uid, &page_input).await?;
    Ok(ok(serde_json::to_value(result)?))
}

/// POST /api/apps/photo/{id}/photos/permanent-delete
pub async fn permanent_delete(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(body): Json<TrashPhotosBody>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let lib_id = parse_uuid(&id)?;
    let photo_ids: Vec<Uuid> = body.photo_ids.iter().map(|s| parse_uuid(s)).collect::<Result<_, _>>()?;
    let deleted = PhotoRepo::permanent_delete(&state.db, lib_id, &photo_ids).await?;

pub async fn rescan(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let uid = parse_uuid(&id)?;

    let library = crate::db::repos::library_repo::PhotoLibraryRepo::get_by_id(&ctx.db, uid)
        .await?
        .not_found(format!("photo library {id} not found"))?;

    if library.sync_status == "syncing" {
        return Err(AppError::Conflict(
            "Photo library is already syncing".into(),
        ));
    }

    // Mark library as syncing
    crate::db::repos::library_repo::PhotoLibraryRepo::update_sync_status(
        &ctx.db, uid, "syncing", None,
    )
    .await?;

    // Trigger VFS walk + photo import in background
    let db = ctx.db.clone();
    let sources = Arc::clone(&ctx.sources);
    let bus_client = Arc::clone(&ctx.client);
    tokio::spawn(async move {
        for pid in &ids {
            let pid_str = pid.to_string();
            let prefix = format!("thumbs/photo/{pid_str}.");
            if let Ok(objects) = storage.list(Some(&prefix)).await {
                for obj in objects {
                    if let Err(e) = storage.delete(&obj.key).await {
                        tracing::warn!("failed to delete thumbnail {}: {e}", obj.key);
                    }
                }
            }
        }
    });

    Ok(ok(serde_json::json!({ "deleted": deleted })))
}

// ─── Rescan ───

/// POST /api/apps/photo/{id}/photos/rescan
pub async fn rescan(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let lib_id = parse_uuid(&id)?;
    let photos = PhotoRepo::get_all_photos_for_rescan(&state.db, lib_id).await?;
    let total = photos.len();

    let unique_source_ids: Vec<Uuid> = {
        let mut ids: Vec<Uuid> = photos.iter().map(|(_, _, sid)| *sid).collect();
        ids.sort();
        ids.dedup();
        ids
    };
    let fs_cache = PhotoRepo::get_file_systems_by_ids(&state.db, unique_source_ids).await?;

    let db = state.db.clone();
    let sources = state.sources.clone();
    let fs_cache = Arc::new(fs_cache);

    tokio::spawn(async move {
        use std::sync::atomic::{AtomicU64, Ordering};
        let updated = Arc::new(AtomicU64::new(0));
        let failed = Arc::new(AtomicU64::new(0));

        const CHUNK_SIZE: usize = 30;
        for chunk in photos.chunks(CHUNK_SIZE) {
            let mut handles = Vec::with_capacity(CHUNK_SIZE);

            for (photo_id, path, source_id) in chunk {
                let db = db.clone();
                let sources = sources.clone();
                let fs_cache = fs_cache.clone();
                let updated = updated.clone();
                let _failed = failed.clone();
                let photo_id = *photo_id;
                let path = path.clone();
                let source_id = *source_id;

                handles.push(tokio::spawn(async move {
                    let fs = fs_cache.get(&source_id);
                    let is_local = fs.is_some_and(|f| f.r#type == "local");

                    if is_local {
                        rescan_local_photo(&db, &path, photo_id, fs).await;
                    } else {
                        rescan_remote_photo(&db, &sources, &path, photo_id, &source_id).await;
                    }

                    updated.fetch_add(1, Ordering::Relaxed);
                }));
            }

            for h in handles {
                if h.await.is_err() {
                    failed.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                }
            }

            let u = updated.load(Ordering::Relaxed);
            let f = failed.load(Ordering::Relaxed);
            if (u + f) % 1000 < CHUNK_SIZE as u64 {
                tracing::info!("[rescan] Progress: {}/{total} (ok={u}, err={f})", u + f);
            }
        }

        let u = updated.load(Ordering::Relaxed);
        let f = failed.load(Ordering::Relaxed);
        tracing::info!("[rescan] Done: {total} scanned — ok={u}, err={f}");
    });

    Ok(ok(
        serde_json::json!({ "queued": total, "message": format!("{total} 张照片已排队全量重扫") }),
    ))
}

/// Live Photo companion video extensions (case-insensitive).
const LIVE_VIDEO_EXTENSIONS: &[&str] = &["mov", "mp4"];

/// Rescan a single local photo: EXIF + dimension fallback.
async fn rescan_local_photo(
    db: &DatabaseConnection,
    path: &str,
    photo_id: Uuid,
    fs: Option<&crate::db::entities::vfs::Model>,
) {
    use crate::handlers::media::utils::resolve_local_path;

    let abs_path = match fs {
        Some(m) => resolve_local_path(path, m.config.as_ref()),
        None => return,
    };

    let abs_for_exif = abs_path.clone();
    let exif_result = named_spawn_blocking("exif-extract", move || {
        tokimo_package_image::extract_exif(&abs_for_exif)
    })
    .await;

    let mut got_dims = false;
    if let Ok(Some(ref exif)) = exif_result {
        if let Err(e) = PhotoRepo::update_exif(db, photo_id, exif).await {
            warn!("photo batch: failed to persist exif for photo {photo_id}: {e}");
        }
        got_dims = exif.width.is_some() && exif.height.is_some();
    }

    let has_date = exif_result
        .as_ref()
        .ok()
        .and_then(|e| e.as_ref())
        .and_then(|e| e.taken_at.as_ref())
        .is_some();
    if !has_date {
        let filename = path.rsplit('/').next().unwrap_or(path);
        if let Some(date_str) = tokimo_package_image::extract_date_from_filename(filename) {
            if let Err(e) = PhotoRepo::update_taken_at(db, photo_id, &date_str).await {
                warn!("photo batch: failed to persist taken_at for photo {photo_id}: {e}");
            }
        } else {
            let abs_for_mtime = abs_path.clone();
            if let Ok(Some(date_str)) = named_spawn_blocking("photo-mtime", move || {
                tokimo_package_image::file_mtime_as_date(&abs_for_mtime)
            })
            .await
                && let Err(e) = PhotoRepo::update_taken_at(db, photo_id, &date_str).await
            {
                warn!("photo batch: failed to persist taken_at for photo {photo_id}: {e}");
            }
        }
    }

    if !got_dims {
        let abs_for_dims = abs_path.clone();
        let dims = named_spawn_blocking("photo-dims", move || {
            tokimo_package_image::get_image_dimensions(&abs_for_dims)
        })
        .await;

        if let Ok(Some((w, h))) = dims
            && let Err(e) = PhotoRepo::update_exif_dimensions(db, photo_id, w, h).await
        {
            warn!("photo batch: failed to persist dimensions for photo {photo_id}: {e}");
        }
    }

    let companion = detect_live_video_companion_local(&abs_path, path);
    if let Some(live_rel) = companion
        && let Err(e) = PhotoRepo::update_live_video_path(db, photo_id, live_rel).await
    {
        warn!("photo batch: failed to persist live_video_path for photo {photo_id}: {e}");
    }
}

/// Rescan a single remote (SMB/NFS) photo: EXIF + dimension fallback.
async fn rescan_remote_photo(
    db: &DatabaseConnection,
    sources: &crate::services::source::SourceRegistry,
    path: &str,
    photo_id: Uuid,
    source_id: &Uuid,
) {
    let source_id_str = source_id.to_string();
    let Ok(vfs) = sources.ensure_vfs(&source_id_str).await else {
        return;
    };

    let Ok(bytes) = vfs.read_bytes(StdPath::new(path), 0, Some(256 * 1024)).await else {
        return;
    };

    let exif_bytes = bytes.clone();
    let exif_result = named_spawn_blocking("exif-bytes", move || {
        tokimo_package_image::extract_exif_from_bytes(&exif_bytes)
    })
    .await;

    let mut got_dims = false;
    let mut got_date = false;
    if let Ok(Some(ref exif)) = exif_result {
        if let Err(e) = PhotoRepo::update_exif(db, photo_id, exif).await {
            warn!("photo batch: failed to persist exif for photo {photo_id}: {e}");
        }
        got_dims = exif.width.is_some() && exif.height.is_some();
        got_date = exif.taken_at.is_some();
    }

    if !got_dims {
        let dim_bytes = bytes.clone();
        let dims = named_spawn_blocking("photo-dims", move || {
            tokimo_package_image::get_image_dimensions_from_bytes(&dim_bytes)
        })
        .await;

        if let Ok(Some((w, h))) = dims {
            if let Err(e) = PhotoRepo::update_exif_dimensions(db, photo_id, w, h).await {
                warn!("photo batch: failed to persist dimensions for photo {photo_id}: {e}");
            }
            got_dims = true;
        }
    }

    let lower = path.to_lowercase();
    let is_heic = std::path::Path::new(&lower)
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("heic"))
        || std::path::Path::new(&lower)
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("heif"));
    if is_heic
        && !got_dims
        && let Ok(full_bytes) = vfs.read_bytes(StdPath::new(path), 0, None).await
    {
        let tmp_path = format!("/tmp/tokimo_rescan_{photo_id}.heic");
        if tokio::fs::write(&tmp_path, &full_bytes).await.is_ok() {
            let tmp_for_dims = tmp_path.clone();
            if let Ok(Some((w, h))) = named_spawn_blocking("photo-dims", move || {
                tokimo_package_image::get_image_dimensions(&tmp_for_dims)
            })
            .await
                && let Err(e) = PhotoRepo::update_exif_dimensions(db, photo_id, w, h).await
            {
                warn!("photo batch: failed to persist dimensions for photo {photo_id}: {e}");
            }
            let _ = tokio::fs::remove_file(&tmp_path).await;
        }
    }

    if !got_date && !is_heic {
        let filename = path.rsplit('/').next().unwrap_or(path);
        if let Some(date_str) = tokimo_package_image::extract_date_from_filename(filename) {
            if let Err(e) = PhotoRepo::update_taken_at(db, photo_id, &date_str).await {
                warn!("photo batch: failed to persist taken_at for photo {photo_id}: {e}");
            }
        } else if let Ok(vfs2) = sources.ensure_vfs(&source_id_str).await
            && let Ok(info) = vfs2.stat(StdPath::new(path)).await
            && let Some(modified) = info.modified
        {
            let date_str = modified.format("%Y-%m-%d %H:%M:%S").to_string();
            if let Err(e) = PhotoRepo::update_taken_at(db, photo_id, &date_str).await {
                warn!("photo batch: failed to persist taken_at for photo {photo_id}: {e}");
            }
        }
    }

    if let Ok(vfs3) = sources.ensure_vfs(&source_id_str).await
        && let Some(live_path) = detect_live_video_companion_remote(&vfs3, path).await
        && let Err(e) = PhotoRepo::update_live_video_path(db, photo_id, live_path).await
    {
        warn!("photo batch: failed to persist live_video_path for photo {photo_id}: {e}");
    }
}

fn detect_live_video_companion_local(abs_path: &str, rel_path: &str) -> Option<String> {
    let abs = StdPath::new(abs_path);
    let stem = abs.file_stem()?.to_str()?;
    let abs_parent = abs.parent()?;
    let rel = StdPath::new(rel_path);
    let rel_parent = rel.parent().and_then(|p| p.to_str()).unwrap_or("");

    for ext in LIVE_VIDEO_EXTENSIONS {
        for ext_variant in [ext.to_lowercase(), ext.to_uppercase()] {
            let candidate = format!("{stem}.{ext_variant}");
            if abs_parent.join(&candidate).exists() {
                return Some(if rel_parent.is_empty() {
                    candidate
                } else {
                    format!("{rel_parent}/{candidate}")
                });
            }
        }
    }
    None
}

async fn detect_live_video_companion_remote(vfs: &tokimo_vfs::Vfs, photo_path: &str) -> Option<String> {
    let path = StdPath::new(photo_path);
    let stem = path.file_stem()?.to_str()?.to_lowercase();
    let dir = path.parent()?;

    let entries = vfs.list(dir).await.ok()?;
    for entry in entries {
        if entry.is_dir {
            continue;
        }
        let name_lower = entry.name.to_lowercase();
        let entry_ext = name_lower.rsplit('.').next().unwrap_or("");
        let entry_stem = name_lower.strip_suffix(&format!(".{entry_ext}")).unwrap_or("");
        if entry_stem == stem && LIVE_VIDEO_EXTENSIONS.contains(&entry_ext) {
            return Some(entry.path);
        }
    }
    None
}

// ─── Per-photo refresh ───

/// POST /api/photos/{id}/refresh-exif
pub async fn refresh_exif(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let photo_id = parse_uuid(&id)?;

    let photo = PhotoRepo::get_model_by_id(&state.db, photo_id)
        .await?
        .not_found("Photo not found")?;

    let source_id = photo.source_id.bad_request("Photo has no source")?;
    let path = photo.path.clone();

    let fs = PhotoRepo::get_file_system_by_id(&state.db, source_id).await?;
    let is_local = fs.as_ref().is_some_and(|f| f.r#type == "local");

    if is_local {
        rescan_local_photo(&state.db, &path, photo_id, fs.as_ref()).await;
    } else {
        rescan_remote_photo(&state.db, &state.sources, &path, photo_id, &source_id).await;
    }

    Ok(ok(serde_json::json!({ "status": "ok" })))
}

/// POST /api/photos/{id}/refresh-thumbnail
pub async fn refresh_thumbnail(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let photo_id = parse_uuid(&id)?;

    PhotoRepo::get_model_by_id(&state.db, photo_id)
        .await?
        .not_found("Photo not found")?;

    let storage = state.storage.get().expect("storage not initialized");
    for w in [64, 128, 160, 240, 320, 480, 640, 960, 1280, 1920] {
        let key = format!("thumbs/photo/{id}.{w}x0.webp");
        let _ = storage.delete(&key).await;
    }

    Ok(ok(serde_json::json!({ "status": "ok" })))
}
