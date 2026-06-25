use sea_orm::*;
use serde::Serialize;
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::bus_clients::media_intelligence as media_bus;
use crate::config::PhotoAiSettings;
use crate::db::entities::photos;
use crate::error::AppError;
use crate::error::OptionExt;
use crate::handlers::media::utils::local_driver_root;

// ── ClipSearchResult ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipSearchResult {
    pub photo_id: String,
    pub filename: String,
    pub thumbnail_path: Option<String>,
    pub similarity: f64,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub taken_at: Option<String>,
    pub is_favorite: bool,
    pub app_id: String,
    pub path: String,
    pub title: Option<String>,
    pub file_size: Option<i64>,
    pub mime_type: Option<String>,
}

// ── PhotoClipService ─────────────────────────────────────────────────────────

pub struct PhotoClipService;

impl PhotoClipService {
    /// Embed image bytes → 512-dim CLIP vector via integrated AI service.
    async fn embed_image(
        bus: &tokimo_bus_client::BusClient,
        user_id: Uuid,
        image: media_bus::ImageInput,
        request_id: Option<String>,
    ) -> Result<Vec<f32>, AppError> {
        let result = media_bus::embed_image(
            bus,
            media_bus::photo_caller(user_id),
            media_bus::EmbedImageRequest { image, request_id },
        )
        .await
        .map_err(|e| AppError::Internal(format!("CLIP img error: {e}")))?;
        let vec = result.embedding;

        if vec.len() != 512 {
            return Err(AppError::Internal(format!(
                "CLIP img returned {} dims, expected 512",
                vec.len()
            )));
        }

        Ok(vec)
    }

    /// Embed text → 512-dim CLIP vector via integrated AI service.
    async fn embed_text(
        bus: &tokimo_bus_client::BusClient,
        user_id: Uuid,
        text: &str,
        request_id: Option<String>,
    ) -> Result<Vec<f32>, AppError> {
        let result = media_bus::embed_text(
            bus,
            media_bus::photo_caller(user_id),
            media_bus::EmbedTextRequest {
                text: text.to_string(),
                request_id,
            },
        )
        .await
        .map_err(|e| AppError::Internal(format!("CLIP txt error: {e}")))?;
        let vec = result.embedding;

        if vec.len() != 512 {
            return Err(AppError::Internal(format!(
                "CLIP txt returned {} dims, expected 512",
                vec.len()
            )));
        }

        Ok(vec)
    }

    /// Format a float vector as a pgvector literal: `[0.1,0.2,...,0.5]`
    fn format_vector(vec: &[f32]) -> String {
        let inner: Vec<String> = vec.iter().map(std::string::ToString::to_string).collect();
        format!("[{}]", inner.join(","))
    }

    /// Store a CLIP vector for a photo (upsert).
    async fn store_vector(db: &DatabaseConnection, photo_id: Uuid, vec: &[f32]) -> Result<(), AppError> {
        let vec_str = Self::format_vector(vec);
        db.execute_raw(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r"INSERT INTO photo_clip_vectors (photo_id, vec, created_at)
               VALUES ($1, $2::vector, NOW())
               ON CONFLICT (photo_id) DO UPDATE SET vec = $2::vector",
            [photo_id.into(), vec_str.into()],
        ))
        .await?;
        Ok(())
    }

    /// Embed a single photo: fetch image bytes, call CLIP, store vector.
    pub async fn embed_photo(
        db: &DatabaseConnection,
        state: &std::sync::Arc<crate::AppState>,
        photo_id: Uuid,
        user_id: Uuid,
    ) -> Result<(), AppError> {
        let photo = photos::Entity::find_by_id(photo_id)
            .one(db)
            .await?
            .not_found("Photo not found")?;

        Self::embed_photo_model(db, state, &photo, user_id).await
    }

    /// Embed a photo from an already-loaded model (avoids redundant DB fetch).
    ///
    /// For CLIP we only need 224×224 input, so we decode HEIC/AVIF at a small
    /// resolution (512px) instead of full-size, which is ~10× faster.
    async fn embed_photo_model(
        _db: &DatabaseConnection,
        state: &std::sync::Arc<crate::AppState>,
        photo: &photos::Model,
        user_id: Uuid,
    ) -> Result<(), AppError> {
        let image_path = photo.thumbnail_path.as_deref().unwrap_or(photo.path.as_str());
        let _ = state
            .bus_client
            .get()
            .ok_or_else(|| AppError::Internal("jobs service unavailable".into()))?;
        crate::services::media_jobs::create_media_job_and_wait(
            state,
            user_id,
            "media_embed_image_photo",
            serde_json::json!({
                "photoId": photo.id,
                "image": media_bus::image_input_for_photo(photo, image_path)?,
            }),
        )
        .await?;

        Ok(())
    }

    pub async fn apply_clip_embedding(db: &DatabaseConnection, photo_id: Uuid, embedding: Vec<f32>) -> Result<(), AppError> {
        if embedding.len() != 512 {
            return Err(AppError::Internal(format!(
                "CLIP img returned {} dims, expected 512",
                embedding.len()
            )));
        }
        Self::store_vector(db, photo_id, &embedding).await
    }

    /// Load bytes for a single photo using a pre-resolved base path (no DB lookup).
    async fn load_bytes_fast(
        state: &std::sync::Arc<crate::AppState>,
        photo: &photos::Model,
        source_base_paths: &std::collections::HashMap<Uuid, String>,
    ) -> Result<Vec<u8>, AppError> {
        let path = photo.thumbnail_path.as_deref().unwrap_or(photo.path.as_str());

        // Try direct file read first (thumbnails, local paths)
        if let Ok(bytes) = tokio::fs::read(path).await {
            return Self::maybe_decode_heic(bytes, &photo.filename).await;
        }

        // Resolve via pre-cached source base path
        if let Some(source_id) = photo.source_id {
            if let Some(base) = source_base_paths.get(&source_id) {
                let combined = format!("{}/{}", base.trim_end_matches('/'), photo.path.trim_start_matches('/'));
                let abs = tokimo_package_utils::path::internal_to_native(&combined);
                if let Ok(bytes) = tokio::fs::read(&abs).await {
                    return Self::maybe_decode_heic(bytes, &photo.filename).await;
                }
            }

            // Remote source — VFS fallback
            let vfs = state.sources.ensure_vfs(&source_id.to_string()).await;
            if let Ok(vfs) = vfs {
                let data = vfs
                    .read_bytes(std::path::Path::new(&photo.path), 0, None)
                    .await
                    .map_err(|e| AppError::Internal(format!("VFS read: {e}")))?;
                return Self::maybe_decode_heic(data, &photo.filename).await;
            }
        }

        Err(AppError::Internal(format!(
            "Cannot load photo bytes for {}",
            photo.filename
        )))
    }

    /// If the file is HEIC/AVIF/RAW, decode to small JPEG; otherwise pass through.
    async fn maybe_decode_heic(raw_bytes: Vec<u8>, filename: &str) -> Result<Vec<u8>, AppError> {
        let lower = filename.to_lowercase();
        if super::ocr::NEEDS_FFMPEG_DECODE.iter().any(|ext| lower.ends_with(ext)) {
            return Self::convert_to_jpeg_small(&raw_bytes, filename).await;
        }
        Ok(raw_bytes)
    }

    /// Load photo bytes optimised for CLIP (small decode size for HEIC/AVIF).
    async fn load_photo_bytes_for_clip(
        db: &DatabaseConnection,
        state: &std::sync::Arc<crate::AppState>,
        photo: &photos::Model,
        path: &str,
    ) -> Result<Vec<u8>, AppError> {
        let raw_bytes = super::ocr::load_raw_bytes(db, &state.sources, photo, path).await?;

        let lower = photo.filename.to_lowercase();
        if super::ocr::NEEDS_FFMPEG_DECODE.iter().any(|ext| lower.ends_with(ext)) {
            return Self::convert_to_jpeg_small(&raw_bytes, &photo.filename).await;
        }

        Ok(raw_bytes)
    }

    /// Decode HEIC/AVIF/RAW to a small JPEG (512px max) via `FFmpeg` FFI.
    async fn convert_to_jpeg_small(raw_bytes: &[u8], filename: &str) -> Result<Vec<u8>, AppError> {
        let fname = filename.to_string();
        let bytes = raw_bytes.to_vec();
        tokio::task::spawn_blocking(move || {
            use tokimo_package_ffmpeg::image::{ImageDecodeOptions, ImageFormat, decode_image_from_bytes};

            let opts = ImageDecodeOptions {
                width: Some(512),
                format: ImageFormat::Jpeg,
                quality: 2,
            };
            decode_image_from_bytes(&bytes, &fname, &opts)
        })
        .await
        .map_err(|e| AppError::Internal(format!("task join error: {e}")))?
        .map_err(|e| AppError::Internal(format!("FFI decode failed for {filename}: {e}")))
    }

    /// Pre-load base paths for all `vfs` used by this app's sources.
    async fn preload_source_base_paths(
        db: &DatabaseConnection,
        app_id: Uuid,
    ) -> Result<std::collections::HashMap<Uuid, String>, AppError> {
        use crate::db::entities::{photos, vfs};

        // Get distinct source_ids from photos
        let source_ids: Vec<Option<Uuid>> = photos::Entity::find()
            .filter(photos::Column::AppId.eq(app_id))
            .filter(photos::Column::SourceId.is_not_null())
            .select_only()
            .column(photos::Column::SourceId)
            .distinct()
            .into_tuple()
            .all(db)
            .await?;

        let mut map = std::collections::HashMap::new();
        for source_id in source_ids.into_iter().flatten() {
            if let Some(fs) = vfs::Entity::find_by_id(source_id).one(db).await?
                && let Some(base) = local_driver_root(&fs)
            {
                map.insert(source_id, base);
            }
        }
        Ok(map)
    }

    /// List photo IDs missing a CLIP vector. Empty Vec when models not ready.
    pub async fn list_pending_photo_ids(
        db: &DatabaseConnection,
        state: &std::sync::Arc<crate::AppState>,
        app_id: Uuid,
    ) -> Result<Vec<Uuid>, AppError> {
        let settings = PhotoAiSettings::for_app(db, app_id).await?;
        if !settings.clip_enabled {
            return Err(AppError::Internal("CLIP not enabled".into()));
        }
        if !state.is_clip_enabled() || !state.clip_models_ready() {
            warn!("[photo_clip] CLIP model files not found, skipping batch for app {app_id}");
            return Ok(Vec::new());
        }
        let ids = photos::Entity::find()
            .filter(photos::Column::AppId.eq(app_id))
            .filter(photos::Column::DeletedAt.is_null())
            .filter(
                photos::Column::Id.not_in_subquery(
                    sea_orm::sea_query::Query::select()
                        .column(crate::db::entities::photo_clip_vectors::Column::PhotoId)
                        .from(crate::db::entities::photo_clip_vectors::Entity)
                        .to_owned(),
                ),
            )
            .select_only()
            .column(photos::Column::Id)
            .into_tuple::<Uuid>()
            .all(db)
            .await?;
        Ok(ids)
    }

    /// Process explicit photo IDs (used by child batch jobs). Lenient: per-photo
    /// failures are recorded as zero vectors so the photo isn't re-queued forever.
    pub async fn process_photo_ids(
        db: &DatabaseConnection,
        state: &std::sync::Arc<crate::AppState>,
        app_id: Uuid,
        ids: Vec<Uuid>,
        user_id: Uuid,
    ) -> (u32, u32, Vec<String>) {
        if ids.is_empty() {
            return (0, 0, Vec::new());
        }
        let mut errors: Vec<String> = Vec::new();
        let mut success = 0u32;
        let mut failures = 0u32;
        const CONCURRENCY: usize = 8;

        // Load photo rows for the given IDs.
        let photos_rows = match photos::Entity::find()
            .filter(photos::Column::Id.is_in(ids.clone()))
            .all(db)
            .await
        {
            Ok(p) => p,
            Err(e) => {
                let msg = format!("failed to load photos: {e}");
                error!("[photo_clip] {msg}");
                errors.push(msg);
                return (0, ids.len() as u32, errors);
            }
        };

        use futures_util::StreamExt;
        let mut futures = futures_util::stream::FuturesUnordered::new();

        for photo in photos_rows {
            let db_c = db.clone();
            let state_c = state.clone();
            futures.push(async move {
                let filename = photo.filename.clone();
                let photo_id = photo.id;
                let result = Self::embed_photo_model(&db_c, &state_c, &photo, user_id).await;
                (photo_id, filename, result)
            });

            if futures.len() >= CONCURRENCY
                && let Some((photo_id, filename, result)) = futures.next().await
            {
                match result {
                    Ok(()) => success += 1,
                    Err(e) => {
                        failures += 1;
                        let msg = format!("Failed for {filename}: {e}");
                        error!("[photo_clip] {msg}");
                        errors.push(msg);
                        let zero_vec = vec![0.0f32; 512];
                        if let Err(e) = Self::store_vector(db, photo_id, &zero_vec).await {
                            warn!("[photo_clip] failed to store zero vector for photo {photo_id}: {e}");
                        }
                    }
                }
            }
        }

        while let Some((photo_id, filename, result)) = futures.next().await {
            match result {
                Ok(()) => success += 1,
                Err(e) => {
                    failures += 1;
                    let msg = format!("Failed for {filename}: {e}");
                    error!("[photo_clip] {msg}");
                    errors.push(msg);
                    let zero_vec = vec![0.0f32; 512];
                    if let Err(e) = Self::store_vector(db, photo_id, &zero_vec).await {
                        warn!("[photo_clip] failed to store zero vector for photo {photo_id}: {e}");
                    }
                }
            }
        }
        (success, failures, errors)
    }

    /// Batch embed all photos in an app that don't yet have a CLIP vector.
    ///
    /// Processes in pages of 500 to avoid loading all rows at once.
    /// Reports progress to the job record so the UI can show real-time status.
    pub async fn embed_app(
        db: &DatabaseConnection,
        state: &std::sync::Arc<crate::AppState>,
        app_id: Uuid,
        job_id: Option<Uuid>,
        user_id: Uuid,
    ) -> Result<u32, AppError> {
        let settings = PhotoAiSettings::for_app(db, app_id).await?;
        if !settings.clip_enabled {
            return Err(AppError::Internal("CLIP not enabled".into()));
        }

        if !state.is_clip_enabled() || !state.clip_models_ready() {
            warn!("[photo_clip] CLIP model files not found, skipping batch for app {app_id}");
            return Ok(0);
        }

        // Count total pending to report accurate progress
        let total = photos::Entity::find()
            .filter(photos::Column::AppId.eq(app_id))
            .filter(photos::Column::DeletedAt.is_null())
            .filter(
                photos::Column::Id.not_in_subquery(
                    sea_orm::sea_query::Query::select()
                        .column(crate::db::entities::photo_clip_vectors::Column::PhotoId)
                        .from(crate::db::entities::photo_clip_vectors::Entity)
                        .to_owned(),
                ),
            )
            .count(db)
            .await? as u32;

        if total == 0 {
            info!("[photo_clip] No photos need CLIP embedding for app {app_id}");
            return Ok(0);
        }

        info!("[photo_clip] Processing {total} photos for app {app_id}");
        let mut success = 0u32;
        let mut processed = 0u32;

        const PAGE_SIZE: u64 = 500;
        const CONCURRENCY: usize = 8;

        loop {
            // Fetch next page of photos without vectors (always page 0 since
            // processed photos get vectors and drop out of the query)
            let page = photos::Entity::find()
                .filter(photos::Column::AppId.eq(app_id))
                .filter(photos::Column::DeletedAt.is_null())
                .filter(
                    photos::Column::Id.not_in_subquery(
                        sea_orm::sea_query::Query::select()
                            .column(crate::db::entities::photo_clip_vectors::Column::PhotoId)
                            .from(crate::db::entities::photo_clip_vectors::Entity)
                            .to_owned(),
                    ),
                )
                .paginate(db, PAGE_SIZE)
                .fetch_page(0)
                .await?;

            if page.is_empty() {
                break;
            }

            // Process photos with bounded concurrency.
            use futures_util::StreamExt;
            let mut futures = futures_util::stream::FuturesUnordered::new();

            for photo in page {
                let db_c = db.clone();
                let state_c = state.clone();
                futures.push(async move {
                    let filename = photo.filename.clone();
                    let photo_id = photo.id;
                    let result = Self::embed_photo_model(&db_c, &state_c, &photo, user_id).await;
                    (photo_id, filename, result)
                });

                // When we hit the concurrency limit, drain one before adding more
                if futures.len() >= CONCURRENCY
                    && let Some((photo_id, filename, result)) = futures.next().await
                {
                    processed += 1;
                    match result {
                        Ok(()) => success += 1,
                        Err(e) => {
                            error!("[photo_clip] Failed for {filename}: {e}");
                            let zero_vec = vec![0.0f32; 512];
                            if let Err(e) = Self::store_vector(db, photo_id, &zero_vec).await {
                                warn!("[photo_clip] failed to store zero vector for photo {photo_id}: {e}");
                            }
                        }
                    }
                    Self::maybe_report_progress(db, job_id, processed, total, success).await;
                }
            }

            // Drain remaining futures
            while let Some((photo_id, filename, result)) = futures.next().await {
                processed += 1;
                match result {
                    Ok(()) => success += 1,
                    Err(e) => {
                        error!("[photo_clip] Failed for {filename}: {e}");
                        let zero_vec = vec![0.0f32; 512];
                        if let Err(e) = Self::store_vector(db, photo_id, &zero_vec).await {
                            warn!("[photo_clip] failed to store zero vector for photo {photo_id}: {e}");
                        }
                    }
                }
                Self::maybe_report_progress(db, job_id, processed, total, success).await;
            }
        }

        info!("[photo_clip] Done: {success}/{total} photos processed ({processed} total attempts)");
        Ok(success)
    }

    /// Report progress to the job record every 50 photos.
    async fn maybe_report_progress(
        db: &DatabaseConnection,
        job_id: Option<Uuid>,
        processed: u32,
        total: u32,
        success: u32,
    ) {
        if processed.is_multiple_of(50) {
            let pct = ((f64::from(processed) / f64::from(total)) * 100.0).min(100.0) as i32;
            info!("[photo_clip] Progress: {processed}/{total} ({pct}%), {success} succeeded");
            if let Some(jid) = job_id {
                let payload = serde_json::json!({
                    "processed": processed,
                    "total": total,
                    "success": success,
                });
                if let Err(e) = crate::db::repos::job_repo::JobRepo::update_progress(db, jid, pct, Some(payload)).await
                {
                    warn!("[photo_clip] job {jid}: failed to update progress: {e}");
                }
            }
        }
    }

    /// Search photos by text using CLIP cosine similarity.
    pub async fn search(
        db: &DatabaseConnection,
        state: &std::sync::Arc<crate::AppState>,
        app_id: Uuid,
        query: &str,
        user_id: Uuid,
    ) -> Result<Vec<ClipSearchResult>, AppError> {
        let settings = PhotoAiSettings::for_app(db, app_id).await?;
        if !settings.clip_enabled {
            return Err(AppError::Internal("CLIP not enabled".into()));
        }

        let bus = state
            .bus_client
            .get()
            .ok_or_else(|| AppError::Internal("Media intelligence service unavailable".into()))?;
        let text_vec = Self::embed_text(bus, user_id, query, None).await?;
        let vec_str = Self::format_vector(&text_vec);

        let rows = db
            .query_all_raw(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r"SELECT p.id as photo_id, p.filename, p.thumbnail_path,
                          p.width, p.height, p.taken_at, p.is_favorite,
                          p.file_size, p.mime_type, p.path, p.title,
                          1 - (v.vec <=> $1::vector) as similarity
                   FROM photo_clip_vectors v
                   JOIN photos p ON p.id = v.photo_id
                   WHERE p.app_id = $2
                     AND p.deleted_at IS NULL
                   ORDER BY v.vec <=> $1::vector
                   LIMIT 50",
                [vec_str.into(), app_id.into()],
            ))
            .await?;

        let mut results = Vec::new();
        for row in rows {
            results.push(ClipSearchResult {
                photo_id: row.try_get::<Uuid>("", "photo_id").unwrap_or_default().to_string(),
                filename: row.try_get::<String>("", "filename").unwrap_or_default(),
                thumbnail_path: row.try_get("", "thumbnail_path").ok(),
                similarity: row.try_get::<f64>("", "similarity").unwrap_or(0.0),
                width: row.try_get("", "width").ok(),
                height: row.try_get("", "height").ok(),
                taken_at: row
                    .try_get::<Option<chrono::DateTime<chrono::FixedOffset>>>("", "taken_at")
                    .ok()
                    .flatten()
                    .map(|dt| dt.to_rfc3339()),
                is_favorite: row.try_get::<bool>("", "is_favorite").unwrap_or(false),
                app_id: app_id.to_string(),
                path: row.try_get("", "path").unwrap_or_default(),
                title: row.try_get("", "title").ok(),
                file_size: row.try_get("", "file_size").ok(),
                mime_type: row.try_get("", "mime_type").ok(),
            });
        }
        Ok(results)
    }
}
