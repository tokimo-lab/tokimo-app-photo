//! `file_scrape` job handler — import a single photo file into the DB.
//!
//! Receives VFS file info from the sync walk, creates a `photos` record,
//! extracts EXIF metadata, and detects Live Photo companions.
//!
//! This is the photo-sidecar equivalent of the monolith's `scrape::photo::handle`.
//! The main server dispatches `file_scrape` jobs to this handler when
//! `libType == "photo"` in the job params.

use std::sync::Arc;

use chrono::{DateTime, FixedOffset, Utc};
use sea_orm::*;
use serde_json::Value as JsonValue;
use uuid::Uuid;

use crate::ctx::AppCtx;
use crate::db::entities::photos;
use crate::error::AppError;
use crate::queue::cancellation::JobCancel;

pub async fn handle(
    ctx: &Arc<AppCtx>,
    _job_id: Uuid,
    params: &JsonValue,
    _user_id: Option<Uuid>,
    _cancel: &JobCancel,
) -> Result<Option<JsonValue>, Box<dyn std::error::Error + Send + Sync>> {
    // Verify this is a photo library job
    let lib_type = params
        .get("libType")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if lib_type != "photo" {
        tracing::warn!("file_scrape: unexpected libType={lib_type}, expected 'photo'");
        return Ok(Some(serde_json::json!({
            "status": "skipped",
            "reason": "unexpected libType",
        })));
    }

    let file_path = params
        .get("filePath")
        .and_then(|v| v.as_str())
        .ok_or("missing filePath")?;
    let dir_path = params
        .get("dirPath")
        .and_then(|v| v.as_str())
        .unwrap_or("/");
    let file_size = params
        .get("fileSize")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let checksum = params
        .get("checksum")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let library_id = params
        .get("photoLibraryId")
        .and_then(|v| v.as_str())
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or("missing photoLibraryId")?;
    let source_id = params
        .get("sourceId")
        .and_then(|v| v.as_str())
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or("missing sourceId")?;

    let filename = file_path
        .rsplit('/')
        .next()
        .unwrap_or(file_path)
        .to_string();

    // Idempotency: skip if already imported
    let existing = photos::Entity::find()
        .filter(photos::Column::AppId.eq(library_id))
        .filter(photos::Column::SourceId.eq(source_id))
        .filter(photos::Column::Path.eq(file_path))
        .one(&ctx.db)
        .await?;

    if let Some(ref photo) = existing {
        // Update checksum if changed
        if photo.checksum.as_deref() != Some(checksum) {
            let mut active: photos::ActiveModel = photo.clone().into();
            active.checksum = Set(Some(checksum.to_string()));
            active.updated_at = Set(Some(Utc::now().fixed_offset()));
            active.update(&ctx.db).await?;
        }
        return Ok(Some(serde_json::json!({
            "status": "skipped",
            "photoId": photo.id.to_string(),
            "reason": "already_exists",
        })));
    }

    // Extract date from filename as fallback for taken_at
    let taken_at = extract_date_from_filename(&filename);

    // Guess MIME type from extension
    let mime_type = guess_photo_mime(&filename);

    let now = Utc::now().fixed_offset();
    let photo_id = Uuid::new_v4();

    let active = photos::ActiveModel {
        id: Set(photo_id),
        app_id: Set(library_id),
        source_id: Set(Some(source_id)),
        filename: Set(filename.clone()),
        path: Set(file_path.to_string()),
        file_size: Set(Some(file_size as i64)),
        mime_type: Set(mime_type),
        taken_at: Set(taken_at),
        checksum: Set(Some(checksum.to_string())),
        is_favorite: Set(false),
        is_hidden: Set(false),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        ..Default::default()
    };

    photos::Entity::insert(active).exec(&ctx.db).await?;

    // Try to extract EXIF metadata from VFS
    if let Ok(vfs) = ctx.sources.ensure_vfs(&source_id.to_string()).await {
        match extract_exif_from_vfs(&vfs, file_path).await {
            Some(exif) => {
                apply_exif(&ctx.db, photo_id, &exif).await?;
            }
            None => {
                tracing::debug!("no EXIF data for {file_path}");
            }
        }

        // Detect Live Photo companion (.mov/.mp4 in same directory)
        detect_live_photo_companion(&ctx.db, &vfs, photo_id, dir_path, &filename)
            .await
            .ok(); // best-effort
    }

    tracing::info!("imported photo {photo_id} from {file_path}");

    Ok(Some(serde_json::json!({
        "status": "created",
        "photoId": photo_id.to_string(),
    })))
}

/// Extract EXIF data from a file via VFS.
async fn extract_exif_from_vfs(
    vfs: &Arc<tokimo_vfs::Vfs>,
    file_path: &str,
) -> Option<ExifData> {
    use std::path::Path;

    // Read first 256KB for EXIF (enough for most images)
    let bytes = vfs
        .read_bytes(Path::new(file_path), 0, Some(256 * 1024))
        .await
        .ok()?;

    // Try parsing EXIF from the partial read
    extract_exif_from_bytes(&bytes).or_else(|| {
        // For HEIC files, EXIF may be beyond 256KB — read the full file
        let ext = Path::new(file_path)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        if ext == "heic" || ext == "heif" {
            // Can't easily read full file here; skip for now
            None
        } else {
            None
        }
    })
}

/// Minimal EXIF data extracted from image bytes.
struct ExifData {
    width: Option<i32>,
    height: Option<i32>,
    taken_at: Option<DateTime<FixedOffset>>,
    camera_make: Option<String>,
    camera_model: Option<String>,
    lens_model: Option<String>,
    focal_length: Option<f64>,
    aperture: Option<f64>,
    shutter_speed: Option<String>,
    iso: Option<i32>,
    orientation: Option<i32>,
    gps_latitude: Option<f64>,
    gps_longitude: Option<f64>,
    gps_altitude: Option<f64>,
    raw_tags: serde_json::Value,
}

/// Extract EXIF from raw image bytes using the `kamadak-exif` crate.
fn extract_exif_from_bytes(bytes: &[u8]) -> Option<ExifData> {
    use exif::{In, Reader, Tag, Value};

    let cursor = std::io::Cursor::new(bytes);
    let reader = Reader::new();
    let exif = reader.read_from_container(&mut std::io::BufReader::new(cursor)).ok()?;

    let get_string = |tag: Tag| -> Option<String> {
        exif.get_field(tag, In::PRIMARY)
            .map(|f| f.display_value().to_string())
            .filter(|s| !s.trim().is_empty())
    };
    let get_f64 = |tag: Tag| -> Option<f64> {
        exif.get_field(tag, In::PRIMARY)
            .and_then(|f| f.display_value().to_string().parse::<f64>().ok())
    };
    let get_i32 = |tag: Tag| -> Option<i32> {
        exif.get_field(tag, In::PRIMARY)
            .and_then(|f| f.display_value().to_string().parse::<i32>().ok())
    };

    // Image dimensions
    let width = get_i32(Tag::PixelXDimension).or_else(|| {
        exif.get_field(Tag::ImageWidth, In::PRIMARY)
            .and_then(|f| match &f.value {
                Value::Long(v) => v.first().map(|&x| x as i32),
                _ => None,
            })
    });
    let height = get_i32(Tag::PixelYDimension).or_else(|| {
        exif.get_field(Tag::ImageLength, In::PRIMARY)
            .and_then(|f| match &f.value {
                Value::Long(v) => v.first().map(|&x| x as i32),
                _ => None,
            })
    });

    // Date
    let taken_at = get_string(Tag::DateTimeOriginal)
        .or_else(|| get_string(Tag::DateTime))
        .and_then(|s| parse_exif_date(&s));

    // GPS
    let gps_latitude = get_f64(Tag::GPSLatitude);
    let gps_longitude = get_f64(Tag::GPSLongitude);
    let gps_altitude = get_f64(Tag::GPSAltitude);

    // Orientation
    let orientation = get_i32(Tag::Orientation);

    // Camera info
    let camera_make = get_string(Tag::Make);
    let camera_model = get_string(Tag::Model);
    let lens_model = get_string(Tag::LensModel);
    let focal_length = get_f64(Tag::FocalLength);
    let aperture = get_f64(Tag::FNumber);
    let iso = get_i32(Tag::ISOSpeed);

    let shutter_speed = get_string(Tag::ExposureTime).map(|s| format!("{}s", s));

    // Collect all raw tags
    let mut raw = serde_json::Map::new();
    for field in exif.fields() {
        let key = format!("{:?}", field.tag);
        let val = field.display_value().to_string();
        raw.insert(key, serde_json::Value::String(val));
    }

    Some(ExifData {
        width,
        height,
        taken_at,
        camera_make,
        camera_model,
        lens_model,
        focal_length,
        aperture,
        shutter_speed,
        iso,
        orientation,
        gps_latitude,
        gps_longitude,
        gps_altitude,
        raw_tags: serde_json::Value::Object(raw),
    })
}

/// Parse EXIF date format "YYYY:MM:DD HH:MM:SS" into a `DateTime<FixedOffset>`.
fn parse_exif_date(s: &str) -> Option<DateTime<FixedOffset>> {
    let trimmed = s.trim();
    if let Ok(naive) = chrono::NaiveDateTime::parse_from_str(trimmed, "%Y:%m:%d %H:%M:%S") {
        return Some(naive.and_utc().fixed_offset());
    }
    if let Ok(naive) = chrono::NaiveDateTime::parse_from_str(trimmed, "%Y-%m-%d %H:%M:%S") {
        return Some(naive.and_utc().fixed_offset());
    }
    None
}

/// Apply extracted EXIF data to an existing photo record.
async fn apply_exif(
    db: &DatabaseConnection,
    photo_id: Uuid,
    exif: &ExifData,
) -> Result<(), AppError> {
    let now = Utc::now().fixed_offset();
    let mut active = photos::ActiveModel {
        id: Set(photo_id),
        ..Default::default()
    };

    if let Some(w) = exif.width {
        active.width = Set(Some(w));
    }
    if let Some(h) = exif.height {
        active.height = Set(Some(h));
    }
    if let Some(ref dt) = exif.taken_at {
        active.taken_at = Set(Some(*dt));
    }
    if let Some(ref v) = exif.camera_make {
        active.camera_make = Set(Some(v.clone()));
    }
    if let Some(ref v) = exif.camera_model {
        active.camera_model = Set(Some(v.clone()));
    }
    if let Some(ref v) = exif.lens_model {
        active.lens_model = Set(Some(v.clone()));
    }
    if let Some(v) = exif.focal_length {
        active.focal_length = Set(Some(v));
    }
    if let Some(v) = exif.aperture {
        active.aperture = Set(Some(v));
    }
    if let Some(ref v) = exif.shutter_speed {
        active.shutter_speed = Set(Some(v.clone()));
    }
    if let Some(v) = exif.iso {
        active.iso = Set(Some(v));
    }
    if let Some(v) = exif.orientation {
        active.orientation = Set(Some(v));
    }
    if let Some(v) = exif.gps_latitude {
        active.gps_latitude = Set(Some(v));
    }
    if let Some(v) = exif.gps_longitude {
        active.gps_longitude = Set(Some(v));
    }
    if let Some(v) = exif.gps_altitude {
        active.gps_altitude = Set(Some(v));
    }
    active.exif_data = Set(Some(exif.raw_tags.clone()));
    active.updated_at = Set(Some(now));
    active.scanned_at = Set(Some(now));

    active.update(db).await?;
    Ok(())
}

/// Detect a Live Photo companion video (.mov/.mp4) in the same directory.
async fn detect_live_photo_companion(
    db: &DatabaseConnection,
    vfs: &Arc<tokimo_vfs::Vfs>,
    photo_id: Uuid,
    dir_path: &str,
    filename: &str,
) -> Result<(), AppError> {
    use std::path::Path;

    let photo_stem = Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("");

    if photo_stem.is_empty() {
        return Ok(());
    }

    let entries = vfs
        .list(Path::new(dir_path))
        .await
        .map_err(|e| AppError::Internal(format!("vfs.list for live photo: {e}")))?;

    for entry in entries {
        if entry.is_dir {
            continue;
        }
        let ext = Path::new(&entry.name)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        if ext == "mov" || ext == "mp4" {
            let video_stem = Path::new(&entry.name)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("");

            if video_stem == photo_stem {
                let video_path = entry.path;
                photos::Entity::update_many()
                    .filter(photos::Column::Id.eq(photo_id))
                    .col_expr(
                        photos::Column::LiveVideoPath,
                        sea_orm::sea_query::Expr::value(Some(video_path)),
                    )
                    .exec(db)
                    .await?;
                return Ok(());
            }
        }
    }

    Ok(())
}

/// Guess MIME type from file extension.
fn guess_photo_mime(filename: &str) -> Option<String> {
    let ext = std::path::Path::new(filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" => Some("image/jpeg".into()),
        "png" => Some("image/png".into()),
        "gif" => Some("image/gif".into()),
        "webp" => Some("image/webp".into()),
        "heic" => Some("image/heic".into()),
        "heif" => Some("image/heif".into()),
        "avif" => Some("image/avif".into()),
        "bmp" => Some("image/bmp".into()),
        "tiff" | "tif" => Some("image/tiff".into()),
        _ => None,
    }
}

/// Extract date from common photo filename patterns.
fn extract_date_from_filename(filename: &str) -> Option<DateTime<FixedOffset>> {
    let name = std::path::Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("");

    // Pattern: IMG_YYYYMMDD_HHMMSS
    if let Some(caps) = regex_match(r"^IMG_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})", name) {
        return parse_date_parts(&caps);
    }

    // Pattern: PixPin_YYYY-MM-DD_HH-MM-SS
    if let Some(caps) = regex_match(r"^PixPin_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})", name) {
        return parse_date_parts(&caps);
    }

    // Pattern: Screenshot_YYYYMMDD-HHMMSS
    if let Some(caps) = regex_match(r"^Screenshot_(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})", name) {
        return parse_date_parts(&caps);
    }

    // Pattern: NNNNNN_YYYYMMDDHHMMSS_N
    if let Some(caps) = regex_match(r"^\d+_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_\d+", name) {
        return parse_date_parts(&caps);
    }

    // Pattern: generic YYYY-MM-DD in filename
    if let Some(caps) = regex_match(r"(\d{4})-(\d{2})-(\d{2})", name) {
        let year: i32 = caps[1].parse().ok()?;
        let month: u32 = caps[2].parse().ok()?;
        let day: u32 = caps[3].parse().ok()?;
        let naive = chrono::NaiveDate::from_ymd_opt(year, month, day)?
            .and_hms_opt(0, 0, 0)?;
        return Some(naive.and_utc().fixed_offset());
    }

    None
}

fn regex_match(pattern: &str, input: &str) -> Option<Vec<String>> {
    let re = regex::Regex::new(pattern).ok()?;
    let caps = re.captures(input)?;
    Some(
        (1..caps.len())
            .filter_map(|i| caps.get(i).map(|m| m.as_str().to_string()))
            .collect(),
    )
}

fn parse_date_parts(parts: &[String]) -> Option<DateTime<FixedOffset>> {
    if parts.len() < 6 {
        return None;
    }
    let year: i32 = parts[0].parse().ok()?;
    let month: u32 = parts[1].parse().ok()?;
    let day: u32 = parts[2].parse().ok()?;
    let hour: u32 = parts[3].parse().ok()?;
    let min: u32 = parts[4].parse().ok()?;
    let sec: u32 = parts[5].parse().ok()?;
    let naive = chrono::NaiveDate::from_ymd_opt(year, month, day)?
        .and_hms_opt(hour, min, sec)?;
    Some(naive.and_utc().fixed_offset())
}
