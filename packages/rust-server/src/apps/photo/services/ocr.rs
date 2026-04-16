use chrono::Utc;
use sea_orm::*;
use serde::Serialize;
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::config::PhotoAiSettings;
use crate::db::entities::{photo_ocr_results, photos};
use crate::error::AppError;
use crate::error::OptionExt;

/// Extensions the `image` crate cannot decode — need `FFmpeg` conversion.
pub(crate) const NEEDS_FFMPEG_DECODE: &[&str] = &[
    ".heic", ".heif", ".avif", ".raw", ".cr2", ".cr3", ".nef", ".arw", ".dng", ".orf", ".rw2", ".pef", ".srw", ".raf",
];

/// Single OCR detection result.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrResult {
    pub text: String,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub w: Option<f64>,
    pub h: Option<f64>,
    pub angle: f64,
    pub score: Option<f64>,
    pub paragraph_id: i32,
    pub char_positions: Option<serde_json::Value>,
    pub positioning_type: String,
    /// 4 corner points [[x,y],...] in [TL, TR, BR, BL] order.
    pub corners: Option<Vec<[f64; 2]>>,
}

// ── PhotoOcrService ──────────────────────────────────────────────────────────

pub struct PhotoOcrService;

impl PhotoOcrService {
    /// Update an existing OCR result's text and/or bounding box.
    pub async fn update_ocr_result(
        db: &DatabaseConnection,
        id: i32,
        input: crate::apps::photo::handlers::ai::UpdateOcrResultInput,
    ) -> Result<photo_ocr_results::Model, AppError> {
        let model = photo_ocr_results::Entity::find_by_id(id).one(db).await?;
        let Some(model) = model else {
            return Err(AppError::NotFound("OCR result not found".into()));
        };

        let mut active: photo_ocr_results::ActiveModel = model.into();
        if let Some(text) = input.text {
            active.text = Set(text);
            // Invalidate machine confidence when text is manually edited
            active.score = Set(None);
        }
        if let Some(x) = input.x {
            active.x = Set(Some(x));
        }
        if let Some(y) = input.y {
            active.y = Set(Some(y));
        }
        if let Some(w) = input.w {
            active.w = Set(Some(w));
        }
        if let Some(h) = input.h {
            active.h = Set(Some(h));
        }
        if let Some(angle) = input.angle {
            active.angle = Set(angle);
        }
        if let Some(corners) = input.corners {
            active.corners = Set(Some(serde_json::json!(corners)));
        }

        let updated = active.update(db).await?;
        Ok(updated)
    }

    /// Delete a single OCR result by id.
    pub async fn delete_ocr_result(db: &DatabaseConnection, id: i32) -> Result<(), AppError> {
        let res = photo_ocr_results::Entity::delete_by_id(id).exec(db).await?;
        if res.rows_affected == 0 {
            return Err(AppError::NotFound("OCR result not found".into()));
        }
        Ok(())
    }

    /// Manually create an OCR result for a photo.
    pub async fn create_ocr_result(
        db: &DatabaseConnection,
        photo_id: Uuid,
        input: crate::apps::photo::handlers::ai::CreateOcrResultInput,
    ) -> Result<photo_ocr_results::Model, AppError> {
        let active = photo_ocr_results::ActiveModel {
            photo_id: Set(photo_id),
            text: Set(input.text),
            x: Set(Some(input.x)),
            y: Set(Some(input.y)),
            w: Set(Some(input.w)),
            h: Set(Some(input.h)),
            corners: Set(input.corners.map(|c| serde_json::json!(c))),
            model_name: Set("manual".to_string()),
            positioning_type: Set("canvas".to_string()),
            ..Default::default()
        };
        let created = photo_ocr_results::Entity::insert(active)
            .exec_with_returning(db)
            .await?;
        Ok(created)
    }

    /// OCR a single photo using the integrated AI service.
    /// Returns (results, `optional_debug_info`).
    async fn ocr_image(
        ai: &rust_models::AiService,
        image_bytes: Vec<u8>,
        model_name: Option<&str>,
        aux_model_name: Option<&str>,
    ) -> Result<(Vec<OcrResult>, Option<serde_json::Value>), AppError> {
        let model = model_name.unwrap_or("rapid-ocr-rust");
        let needs_hybrid = !rust_models::ocr_manager::OcrManager::model_supports_blocks(model);

        let (items, debug) = if needs_hybrid {
            let det_model = aux_model_name.unwrap_or("rapid-ocr-rust");
            let (items, debug) = ai
                .ocr_hybrid(&image_bytes, det_model, model)
                .await
                .map_err(|e| AppError::Internal(format!("OCR error: {e}")))?;
            (items, debug)
        } else {
            let items = ai
                .ocr(&image_bytes, Some(model))
                .await
                .map_err(|e| AppError::Internal(format!("OCR error: {e}")))?;
            (items, None)
        };

        let mut results = Vec::new();
        for item in items {
            if item.text.trim().is_empty() {
                continue;
            }
            // -1.0 sentinel from sidecar means "no coordinates available"
            let coord = |v: f32| -> Option<f64> { if v < 0.0 { None } else { Some(f64::from(v)) } };
            let positioning_type = if item.char_positions.is_some() {
                "ctc".to_string()
            } else {
                "canvas".to_string()
            };
            results.push(OcrResult {
                text: item.text,
                x: coord(item.x),
                y: coord(item.y),
                w: coord(item.w),
                h: coord(item.h),
                angle: f64::from(item.angle),
                score: Some(f64::from(item.score)),
                paragraph_id: item.paragraph_id as i32,
                char_positions: item.char_positions.map(|positions| {
                    serde_json::json!(
                        positions
                            .iter()
                            .map(|(x, w)| serde_json::json!({"x": f64::from(*x), "w": f64::from(*w)}))
                            .collect::<Vec<_>>()
                    )
                }),
                positioning_type,
                corners: item
                    .corners
                    .map(|c| c.iter().map(|(x, y)| [f64::from(*x), f64::from(*y)]).collect()),
            });
        }

        Ok((results, debug))
    }

    /// OCR a single photo: fetch image bytes, call OCR, store results.
    pub async fn ocr_photo(
        db: &DatabaseConnection,
        state: &std::sync::Arc<crate::AppState>,
        photo_id: Uuid,
    ) -> Result<usize, AppError> {
        let photo = photos::Entity::find_by_id(photo_id)
            .one(db)
            .await?
            .not_found("Photo not found")?;

        let settings = PhotoAiSettings::for_app(db, photo.app_id).await?;

        let model_name = settings.ocr_model_name.clone();
        let aux_model_name = settings.ocr_aux_model_name.clone();

        // Get thumbnail bytes (prefer thumbnail, fallback to original)
        let image_path = photo.thumbnail_path.as_deref().unwrap_or(photo.path.as_str());

        let image_bytes = load_photo_bytes(db, &state.sources, &photo, image_path).await?;

        let (results, debug_info) =
            Self::ocr_image(&state.ai, image_bytes, Some(&model_name), aux_model_name.as_deref()).await?;
        let count = results.len();

        if !results.is_empty() {
            // Delete existing OCR results for this photo
            photo_ocr_results::Entity::delete_many()
                .filter(photo_ocr_results::Column::PhotoId.eq(photo_id))
                .exec(db)
                .await?;

            // Insert new results
            let now = Utc::now().fixed_offset();
            for r in &results {
                let model = photo_ocr_results::ActiveModel {
                    photo_id: Set(photo_id),
                    text: Set(r.text.clone()),
                    x: Set(r.x),
                    y: Set(r.y),
                    w: Set(r.w),
                    h: Set(r.h),
                    angle: Set(r.angle),
                    score: Set(r.score),
                    paragraph_id: Set(r.paragraph_id),
                    char_positions: Set(r.char_positions.clone()),
                    model_name: Set(model_name.clone()),
                    positioning_type: Set(r.positioning_type.clone()),
                    corners: Set(r.corners.as_ref().map(|c| serde_json::json!(c))),
                    created_at: Set(now),
                    ..Default::default()
                };
                if let Err(e) = photo_ocr_results::Entity::insert(model).exec(db).await {
                    warn!("Failed to insert OCR result for photo {photo_id}: {e}");
                }
            }
        }

        // Mark photo as OCR scanned + store debug info
        let mut active: photos::ActiveModel = photo.into();
        active.ocr_scanned_at = Set(Some(Utc::now().fixed_offset()));
        active.ocr_debug_info = Set(debug_info);
        active.update(db).await?;

        Ok(count)
    }

    /// Batch OCR all unscanned photos in an app.
    pub async fn ocr_app(
        db: &DatabaseConnection,
        state: &std::sync::Arc<crate::AppState>,
        app_id: Uuid,
    ) -> Result<u32, AppError> {
        let settings = PhotoAiSettings::for_app(db, app_id).await?;
        if !settings.ocr_enabled {
            return Err(AppError::Internal("OCR not enabled".into()));
        }

        if !state.ai.is_ocr_enabled() || !state.ai.ocr_models_ready() {
            warn!("[photo_ocr] OCR model files not found, skipping batch for app {app_id}");
            return Ok(0);
        }

        let pending = photos::Entity::find()
            .filter(photos::Column::AppId.eq(app_id))
            .filter(photos::Column::OcrScannedAt.is_null())
            .filter(photos::Column::DeletedAt.is_null())
            .all(db)
            .await?;

        let total = pending.len();
        if total == 0 {
            info!("[photo_ocr] No photos need OCR for app {app_id}");
            return Ok(0);
        }

        info!("[photo_ocr] Processing {total} photos for app {app_id}");
        let mut success = 0u32;

        for photo in &pending {
            match Self::ocr_photo(db, state, photo.id).await {
                Ok(count) => {
                    success += 1;
                    if count > 0 {
                        info!("[photo_ocr] {} text regions found in {}", count, photo.filename);
                    }
                }
                Err(e) => {
                    error!("[photo_ocr] Failed for {}: {e}", photo.filename);
                }
            }

            // Brief pause to avoid overwhelming the AI server
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }

        info!("[photo_ocr] Done: {success}/{total} photos processed");
        Ok(success)
    }

    /// Search OCR text across all photos in an app.
    pub async fn search_ocr_text(
        db: &DatabaseConnection,
        app_id: Uuid,
        query: &str,
    ) -> Result<Vec<OcrSearchResult>, AppError> {
        use sea_orm::{ConnectionTrait, DatabaseBackend, Statement};

        let rows = db
            .query_all_raw(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r"
                SELECT DISTINCT p.id as photo_id, p.filename, p.thumbnail_path,
                       string_agg(r.text, ' ') as matched_text
                FROM photo_ocr_results r
                JOIN photos p ON p.id = r.photo_id
                WHERE p.app_id = $1
                  AND p.deleted_at IS NULL
                  AND r.text ILIKE '%' || $2 || '%'
                GROUP BY p.id, p.filename, p.thumbnail_path
                ORDER BY p.filename
                LIMIT 100
                ",
                [app_id.into(), query.into()],
            ))
            .await?;

        let mut results = Vec::new();
        for row in rows {
            results.push(OcrSearchResult {
                photo_id: row.try_get::<Uuid>("", "photo_id").unwrap_or_default().to_string(),
                filename: row.try_get::<String>("", "filename").unwrap_or_default(),
                thumbnail_path: row.try_get("", "thumbnail_path").ok(),
                matched_text: row.try_get::<String>("", "matched_text").unwrap_or_default(),
            });
        }
        Ok(results)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrSearchResult {
    pub photo_id: String,
    pub filename: String,
    pub thumbnail_path: Option<String>,
    pub matched_text: String,
}

/// Load photo bytes — handles local filesystem and VFS sources.
/// Automatically converts formats unsupported by the `image` crate (HEIC, AVIF,
/// RAW, etc.) to JPEG via `FFmpeg` so downstream AI services can decode them.
pub(crate) async fn load_photo_bytes(
    db: &DatabaseConnection,
    sources: &std::sync::Arc<crate::services::media::source::SourceRegistry>,
    photo: &photos::Model,
    path: &str,
) -> Result<Vec<u8>, AppError> {
    let raw_bytes = load_raw_bytes(db, sources, photo, path).await?;

    // Convert unsupported formats to JPEG via FFmpeg
    let lower = photo.filename.to_lowercase();
    if NEEDS_FFMPEG_DECODE.iter().any(|ext| lower.ends_with(ext)) {
        return convert_to_jpeg_via_ffmpeg(&raw_bytes, &photo.filename).await;
    }

    Ok(raw_bytes)
}

/// Load raw file bytes from local filesystem or VFS.
pub(crate) async fn load_raw_bytes(
    db: &DatabaseConnection,
    sources: &std::sync::Arc<crate::services::media::source::SourceRegistry>,
    photo: &photos::Model,
    path: &str,
) -> Result<Vec<u8>, AppError> {
    use crate::db::entities::vfs;

    // Try local file first (thumbnail_path is usually local)
    if let Ok(bytes) = tokio::fs::read(path).await {
        return Ok(bytes);
    }

    // Fallback: resolve via VFS if source exists
    if let Some(source_id) = photo.source_id {
        let fs = vfs::Entity::find_by_id(source_id).one(db).await?;
        if let Some(fs_model) = fs {
            if fs_model.r#type == "local" {
                let base_path = fs_model
                    .config
                    .as_ref()
                    .and_then(|c: &serde_json::Value| c.as_object())
                    .and_then(|o| o.get("root_folder_path").or_else(|| o.get("rootPath")))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let abs_path = format!(
                    "{}/{}",
                    base_path.trim_end_matches('/'),
                    photo.path.trim_start_matches('/')
                );
                if let Ok(bytes) = tokio::fs::read(&abs_path).await {
                    return Ok(bytes);
                }
            } else {
                // Remote source — use VFS
                let vfs = sources.ensure_vfs(&source_id.to_string()).await;
                if let Ok(vfs) = vfs {
                    let data = vfs
                        .read_bytes(std::path::Path::new(&photo.path), 0, None)
                        .await
                        .map_err(|e| AppError::Internal(format!("VFS read error: {e}")))?;
                    return Ok(data);
                }
            }
        }
    }

    Err(AppError::Internal(format!(
        "Cannot load photo bytes for {}",
        photo.filename
    )))
}

/// Convert image bytes to JPEG using `FFmpeg` FFI (for HEIC, AVIF, RAW, etc.).
async fn convert_to_jpeg_via_ffmpeg(raw_bytes: &[u8], filename: &str) -> Result<Vec<u8>, AppError> {
    let fname = filename.to_string();
    let bytes = raw_bytes.to_vec();
    let result = tokio::task::spawn_blocking(move || {
        use ffmpeg_tool::image::{ImageDecodeOptions, ImageFormat, decode_image_from_bytes};

        let opts = ImageDecodeOptions {
            width: None,
            format: ImageFormat::Jpeg,
            quality: 2,
        };
        decode_image_from_bytes(&bytes, &fname, &opts)
    })
    .await
    .map_err(|e| AppError::Internal(format!("task join error: {e}")))?
    .map_err(|e| AppError::Internal(format!("FFI decode failed for {filename}: {e}")))?;

    info!(
        "[photo] Converted {filename} ({} KB) → JPEG ({} KB) via FFI",
        raw_bytes.len() / 1024,
        result.len() / 1024
    );

    Ok(result)
}
