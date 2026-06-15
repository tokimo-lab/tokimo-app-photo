//! Photo library scrape handler.
//!
//! Dedicated early-return branch — entirely separate from the video pipeline.
//! Inserts the photo record, extracts EXIF (local or remote), detects Live Photo
//! companions, then returns without touching NFO / TMDB / artwork discovery.

use chrono::NaiveDateTime;
use sea_orm::*;
use serde_json::{Value as JsonValue, json};
use std::sync::Arc;
use tracing::{debug, info, warn};
use uuid::Uuid;

use crate::AppState;
use crate::common::thread_util::named_spawn_blocking;
use crate::db::entities::{photos, vfs};
use crate::queue::AppEvent;

use crate::services::scrape::shared::constants::{guess_photo_mime, is_photo_file};

type BoxError = Box<dyn std::error::Error + Send + Sync>;

const LIVE_VIDEO_EXTENSIONS: &[&str] = &["mov", "mp4"];

pub async fn handle(
    db: &DatabaseConnection,
    state: &Arc<AppState>,
    source_id: &str,
    app_uuid: Uuid,
    source_uuid: Uuid,
    file_path: &str,
    file_size: i64,
    user_id: Option<Uuid>,
) -> Result<Option<JsonValue>, BoxError> {
    let filename = file_path.rsplit('/').next().unwrap_or(file_path);

    if !is_photo_file(filename) {
        return Ok(Some(json!({ "skipped": true, "reason": "not_a_photo" })));
    }

    // Idempotency
    let existing = photos::Entity::find()
        .filter(photos::Column::SourceId.eq(source_uuid))
        .filter(photos::Column::Path.eq(file_path))
        .filter(photos::Column::AppId.eq(app_uuid))
        .one(db)
        .await?;

    if existing.is_some() {
        debug!("[photo_scrape] Photo already indexed, skipping: {file_path}");
        return Ok(Some(json!({ "skipped": true, "reason": "already_ingested" })));
    }

    let photo_id = Uuid::new_v4();
    let now = chrono::Utc::now().fixed_offset();
    let mime_type = guess_photo_mime(filename);

    let taken_at_from_filename = tokimo_package_image::extract_date_from_filename(filename).and_then(|date_str| {
        NaiveDateTime::parse_from_str(&date_str, "%Y-%m-%d %H:%M:%S")
            .ok()
            .map(|ndt| ndt.and_utc().fixed_offset())
    });

    let model = photos::ActiveModel {
        id: Set(photo_id),
        app_id: Set(app_uuid),
        source_id: Set(Some(source_uuid)),
        filename: Set(filename.to_string()),
        path: Set(file_path.to_string()),
        title: Set(None),
        description: Set(None),
        width: Set(None),
        height: Set(None),
        file_size: Set(if file_size > 0 { Some(file_size) } else { None }),
        mime_type: Set(mime_type),
        taken_at: Set(taken_at_from_filename),
        camera_make: Set(None),
        camera_model: Set(None),
        lens_model: Set(None),
        focal_length: Set(None),
        aperture: Set(None),
        shutter_speed: Set(None),
        iso: Set(None),
        orientation: Set(None),
        exif_data: Set(None),
        gps_latitude: Set(None),
        gps_longitude: Set(None),
        gps_altitude: Set(None),
        location_name: Set(None),
        geo_province: Set(None),
        geo_city: Set(None),
        geo_district: Set(None),
        geo_township: Set(None),
        geo_adcode: Set(None),
        geo_address: Set(None),
        thumbnail_path: Set(None),
        is_favorite: Set(false),
        is_hidden: Set(false),
        photo_album_id: Set(None),
        color_dominant: Set(None),
        live_video_path: Set(None),
        ocr_scanned_at: Set(None),
        ocr_debug_info: Set(None),
        scanned_at: Set(Some(now)),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
        checksum: Set(None),
    };

    photos::Entity::insert(model).exec(db).await?;
    if let Some(user_id) = user_id {
        let _ = state.event_tx.send(AppEvent::AppEntityEvent {
            user_id,
            app_id: "photo".into(),
            kind: "photo_item".into(),
            scope: Some(format!("library:{app_uuid}")),
            payload: json!({
                "id": photo_id.to_string(),
                "libraryId": app_uuid.to_string(),
                "operation": "created"
            }),
        });
    }
    info!("[photo_scrape] Created photo: {filename} ({photo_id})");

    let fs = vfs::Entity::find_by_id(source_uuid).one(db).await.ok().flatten();
    let is_local = fs.as_ref().is_some_and(|f| f.r#type == "local");

    if is_local {
        extract_local(db, state, source_uuid, photo_id, file_path, filename, fs).await;
    } else {
        extract_remote(db, state, source_id, photo_id, file_path, filename).await;
    }

    // Live Photo companion
    if is_local {
        if let Some(fs_model) = vfs::Entity::find_by_id(source_uuid).one(db).await.ok().flatten() {
            let abs_path = crate::handlers::media::utils::resolve_local_path(file_path, fs_model.config.as_ref());
            if let Some(live_rel) = detect_live_companion_local(&abs_path, file_path) {
                let active = photos::ActiveModel {
                    id: Set(photo_id),
                    live_video_path: Set(Some(live_rel.clone())),
                    ..Default::default()
                };
                if let Err(e) = active.update(db).await {
                    warn!("[photo_scrape] failed to update live_video_path (local) for {photo_id}: {e}");
                }
                info!("[photo_scrape] Live Photo companion: {live_rel}");
            }
        }
    } else if let Ok(vfs) = state.sources.ensure_vfs(source_id).await
        && let Some(live_rel) = detect_live_companion_vfs(&vfs, file_path).await
    {
        let active = photos::ActiveModel {
            id: Set(photo_id),
            live_video_path: Set(Some(live_rel.clone())),
            ..Default::default()
        };
        if let Err(e) = active.update(db).await {
            warn!("[photo_scrape] failed to update live_video_path (remote) for {photo_id}: {e}");
        }
        info!("[photo_scrape] Live Photo companion (remote): {live_rel}");
    }

    Ok(Some(json!({
        "filePath": file_path,
        "photoId": photo_id.to_string(),
    })))
}

// ── EXIF extraction ──────────────────────────────────────────────────────────

async fn extract_local(
    db: &DatabaseConnection,
    _state: &Arc<AppState>,
    source_uuid: Uuid,
    photo_id: Uuid,
    file_path: &str,
    filename: &str,
    fs: Option<crate::db::entities::vfs::Model>,
) {
    // already fetched above, just re-fetch if not passed — shouldn't happen
    let Some(fs_model) = fs else {
        return;
    };
    let abs_path = crate::handlers::media::utils::resolve_local_path(file_path, fs_model.config.as_ref());

    let abs_for_exif = abs_path.clone();
    let exif_result =
        named_spawn_blocking("scrape-exif", move || tokimo_package_image::extract_exif(&abs_for_exif)).await;

    let mut got_dims = false;
    if let Ok(Some(exif)) = &exif_result {
        apply_exif(db, photo_id, exif, filename).await;
        got_dims = exif.width.is_some() && exif.height.is_some();
    }

    if !got_dims {
        let abs_for_dims = abs_path.clone();
        let dims = named_spawn_blocking("scrape-dims", move || {
            tokimo_package_image::get_image_dimensions(&abs_for_dims)
        })
        .await;
        if let Ok(Some((w, h))) = dims {
            let _ = photos::ActiveModel {
                id: Set(photo_id),
                width: Set(Some(w)),
                height: Set(Some(h)),
                ..Default::default()
            }
            .update(db)
            .await;
        }
    }

    // Local source doesn't need source_uuid for VFS, suppress warning
    let _ = source_uuid;
}

async fn extract_remote(
    db: &DatabaseConnection,
    state: &Arc<AppState>,
    source_id: &str,
    photo_id: Uuid,
    file_path: &str,
    filename: &str,
) {
    let Ok(vfs) = state.sources.ensure_vfs(source_id).await else {
        return;
    };
    let Ok(bytes) = vfs
        .read_bytes(std::path::Path::new(file_path), 0, Some(256 * 1024))
        .await
    else {
        return;
    };

    let exif_bytes = bytes.clone();
    let exif_result = named_spawn_blocking("scrape-exif", move || {
        tokimo_package_image::extract_exif_from_bytes(&exif_bytes)
    })
    .await;

    let mut got_dims = false;
    if let Ok(Some(exif)) = &exif_result {
        apply_exif(db, photo_id, exif, filename).await;
        got_dims = exif.width.is_some() && exif.height.is_some();
    }

    if !got_dims {
        let dim_bytes = bytes.clone();
        if let Ok(Some((w, h))) = named_spawn_blocking("scrape-dims", move || {
            tokimo_package_image::get_image_dimensions_from_bytes(&dim_bytes)
        })
        .await
        {
            let _ = photos::ActiveModel {
                id: Set(photo_id),
                width: Set(Some(w)),
                height: Set(Some(h)),
                ..Default::default()
            }
            .update(db)
            .await;
            got_dims = true;
        }
    }

    let lower = filename.to_lowercase();
    let is_heic = std::path::Path::new(&lower)
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("heic"))
        || std::path::Path::new(&lower)
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("heif"));
    if is_heic
        && !got_dims
        && let Ok(full_bytes) = vfs.read_bytes(std::path::Path::new(file_path), 0, None).await
    {
        let tmp_path = format!("/tmp/tokimo_exif_{photo_id}.heic");
        if tokio::fs::write(&tmp_path, &full_bytes).await.is_ok() {
            let tmp_for_dims = tmp_path.clone();
            if let Ok(Some((w, h))) = named_spawn_blocking("scrape-dims", move || {
                tokimo_package_image::get_image_dimensions(&tmp_for_dims)
            })
            .await
            {
                let _ = photos::ActiveModel {
                    id: Set(photo_id),
                    width: Set(Some(w)),
                    height: Set(Some(h)),
                    ..Default::default()
                }
                .update(db)
                .await;
            }
            let _ = tokio::fs::remove_file(&tmp_path).await;
        }
    }
}

/// Apply extracted EXIF data to a photo record.
async fn apply_exif(db: &DatabaseConnection, photo_id: Uuid, exif: &tokimo_package_image::ExifData, filename: &str) {
    let mut active = photos::ActiveModel {
        id: Set(photo_id),
        ..Default::default()
    };

    if let Some(ref date_str) = exif.taken_at {
        let cleaned = date_str.trim_matches('"');
        let normalised = if cleaned.len() >= 10 && &cleaned[4..5] == ":" && &cleaned[7..8] == ":" {
            format!(
                "{}-{}-{}{}",
                &cleaned[0..4],
                &cleaned[5..7],
                &cleaned[8..10],
                &cleaned[10..]
            )
        } else {
            cleaned.to_string()
        };
        if let Ok(dt) = NaiveDateTime::parse_from_str(&normalised, "%Y-%m-%d %H:%M:%S") {
            active.taken_at = Set(Some(dt.and_utc().fixed_offset()));
        }
    }

    if exif.camera_make.is_some() {
        active.camera_make = Set(exif.camera_make.clone());
    }
    if exif.camera_model.is_some() {
        active.camera_model = Set(exif.camera_model.clone());
    }
    if exif.lens_model.is_some() {
        active.lens_model = Set(exif.lens_model.clone());
    }
    if exif.focal_length.is_some() {
        active.focal_length = Set(exif.focal_length);
    }
    if exif.aperture.is_some() {
        active.aperture = Set(exif.aperture);
    }
    if exif.shutter_speed.is_some() {
        active.shutter_speed = Set(exif.shutter_speed.clone());
    }
    if exif.iso.is_some() {
        active.iso = Set(exif.iso);
    }
    if exif.orientation.is_some() {
        active.orientation = Set(exif.orientation);
    }
    if exif.width.is_some() {
        active.width = Set(exif.width);
    }
    if exif.height.is_some() {
        active.height = Set(exif.height);
    }
    if exif.gps_latitude.is_some() {
        active.gps_latitude = Set(exif.gps_latitude);
    }
    if exif.gps_longitude.is_some() {
        active.gps_longitude = Set(exif.gps_longitude);
    }
    if exif.gps_altitude.is_some() {
        active.gps_altitude = Set(exif.gps_altitude);
    }

    if !exif.raw_tags.is_empty() {
        active.exif_data = Set(Some(serde_json::to_value(&exif.raw_tags).unwrap_or_default()));
    }

    if let Err(e) = active.update(db).await {
        warn!("[photo_scrape] Failed to update EXIF for {photo_id}: {e}");
    } else {
        info!("[photo_scrape] EXIF extracted for {filename}");
    }
}

// ── Live Photo companion detection ───────────────────────────────────────────

fn detect_live_companion_local(abs_path: &str, rel_path: &str) -> Option<String> {
    let abs = std::path::Path::new(abs_path);
    let stem = abs.file_stem()?.to_str()?;
    let abs_parent = abs.parent()?;
    let rel = std::path::Path::new(rel_path);
    let rel_parent = rel.parent().and_then(|p| p.to_str()).unwrap_or("");

    for ext in LIVE_VIDEO_EXTENSIONS {
        for ext_variant in [ToString::to_string(ext), ext.to_uppercase()] {
            let candidate_name = format!("{stem}.{ext_variant}");
            if abs_parent.join(&candidate_name).exists() {
                return Some(if rel_parent.is_empty() {
                    candidate_name
                } else {
                    format!("{rel_parent}/{candidate_name}")
                });
            }
        }
    }
    None
}

async fn detect_live_companion_vfs(vfs: &tokimo_vfs::Vfs, photo_path: &str) -> Option<String> {
    let path = std::path::Path::new(photo_path);
    let stem = path.file_stem()?.to_str()?.to_lowercase();
    let dir = path.parent()?;

    let entries = vfs.list(dir).await.ok()?;
    for entry in entries {
        if entry.is_dir {
            continue;
        }
        let name_lower = entry.name.to_lowercase();
        let entry_stem = name_lower.rsplit('.').nth(1).unwrap_or("");
        let entry_ext = name_lower.rsplit('.').next().unwrap_or("");
        if entry_stem == stem && LIVE_VIDEO_EXTENSIONS.contains(&entry_ext) {
            return Some(entry.path);
        }
    }
    None
}
