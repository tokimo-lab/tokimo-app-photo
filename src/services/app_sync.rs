//! Photo library sync — VFS walk + photo import orchestration.
//!
//! Ported from the monolith's `AppSyncService::do_photo_sync` / `sync_fs_source`.
//! The flow:
//!   1. Parse sources from `photo_libraries.sources` JSON
//!   2. For each source, walk VFS with `PHOTO_EXTENSIONS`
//!   3. Check existing photos in DB (by path + checksum)
//!   4. Create `photo_scrape` jobs for new/changed photos via bus
//!   5. Clean up photos that no longer exist on disk

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, OnceLock};

use chrono::Utc;
use sea_orm::*;
use serde_json::json;
use tokio::sync::mpsc;
use tracing::{error, info, warn};
use uuid::Uuid;

use tokimo_bus_client::BusClient;

use crate::bus_clients::jobs::{self as jobs_client, CreateJobRequest, JobFilter};
use crate::db::entities::{
    photo_albums, photo_clip_vectors, photo_faces, photo_ocr_results, photo_persons, photos, vfs,
};
use crate::db::repos::library_repo::PhotoLibraryRepo;
use crate::error::{AppError, OptionExt};
use crate::handlers::vfs::ops::{FileInfo, PHOTO_EXTENSIONS, walk_files_streaming};
use crate::services::source::{SourceRegistry, to_vfs_path};

/// Create a job filter scoped to a photo library.
fn photo_library_filter(library_id: Uuid, status: Option<&str>) -> JobFilter {
    let mut params_match = HashMap::new();
    params_match.insert("photoLibraryId".to_string(), library_id.to_string());
    JobFilter {
        status: status.map(String::from),
        job_type: None,
        params_match: Some(params_match),
        parents_only: None,
    }
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub total_jobs: u64,
}

pub struct AppSyncService;

impl AppSyncService {
    /// Execute sync for a photo library.
    ///
    /// Reads from `photo_libraries` table, parses sources, walks VFS,
    /// and creates `photo_scrape` jobs for new/changed files.
    pub async fn execute_photo_sync(
        db: &DatabaseConnection,
        sources: &SourceRegistry,
        bus_client: &Arc<OnceLock<Arc<BusClient>>>,
        library_id: Uuid,
        clear_data: bool,
        user_id: Uuid,
    ) -> Result<SyncResult, AppError> {
        let library = PhotoLibraryRepo::get_by_id(db, library_id)
            .await?
            .not_found("photo library not found")?;

        info!("Starting photo sync for \"{}\" (id={})", library.name, library_id);

        let result = Self::do_photo_sync(db, sources, bus_client, &library, clear_data, user_id).await;

        match &result {
            Ok(sync_result) => {
                let now = Utc::now();
                PhotoLibraryRepo::update_sync_status(db, library_id, "completed", Some(now.fixed_offset())).await?;
                info!(
                    "Photo sync completed: \"{}\" — {} jobs dispatched",
                    library.name, sync_result.total_jobs
                );
            }
            Err(err) => {
                error!("Photo sync failed for \"{}\": {}", library.name, err);
                if let Err(e) = PhotoLibraryRepo::update_sync_status(db, library_id, "failed", None).await {
                    warn!("photo sync {library_id}: failed to mark sync_status=failed: {e}");
                }
            }
        }

        result
    }

    /// Core photo sync logic.
    async fn do_photo_sync(
        db: &DatabaseConnection,
        sources: &SourceRegistry,
        bus_client: &Arc<OnceLock<Arc<BusClient>>>,
        library: &crate::db::entities::photo_libraries::Model,
        clear_data: bool,
        user_id: Uuid,
    ) -> Result<SyncResult, AppError> {
        let library_id = library.id;

        let client = bus_client
            .get()
            .ok_or_else(|| AppError::Internal("bus client not initialized".into()))?;

        if clear_data {
            Self::clear_library_data(db, library_id).await?;
        }

        // Clean up old finished jobs
        let filter = photo_library_filter(library_id, None);
        let _ = jobs_client::cleanup(client, jobs_client::photo_caller(Some(user_id)), filter).await;

        let source_tuples = PhotoLibraryRepo::parse_sources(&library.sources);
        if source_tuples.is_empty() {
            info!("  No sources configured for photo library, skipping");
            return Ok(SyncResult { total_jobs: 0 });
        }

        let mut total_jobs = 0u64;

        for (source_id, root_path, _is_default) in &source_tuples {
            let source = vfs::Entity::find_by_id(*source_id)
                .one(db)
                .await?
                .ok_or_else(|| AppError::NotFound(format!("source {source_id} not found")))?;

            let jobs = Self::sync_fs_source(db, sources, bus_client, library_id, &source, root_path, user_id).await?;
            total_jobs += jobs;
        }

        Ok(SyncResult { total_jobs })
    }

    /// Clear all photo data for a library, including derived tables.
    async fn clear_library_data(db: &DatabaseConnection, library_id: Uuid) -> Result<(), AppError> {
        info!("Clearing data for photo library {library_id}");

        let txn = db.begin().await?;

        // Delete derived tables first (they reference photos)
        let photo_ids: Vec<Uuid> = photos::Entity::find()
            .filter(photos::Column::AppId.eq(library_id))
            .select_only()
            .column(photos::Column::Id)
            .into_tuple::<Uuid>()
            .all(&txn)
            .await?;

        if !photo_ids.is_empty() {
            let deleted = photo_clip_vectors::Entity::delete_many()
                .filter(photo_clip_vectors::Column::PhotoId.is_in(photo_ids.clone()))
                .exec(&txn)
                .await?
                .rows_affected;
            info!("  Deleted {deleted} CLIP vectors");

            let deleted = photo_faces::Entity::delete_many()
                .filter(photo_faces::Column::PhotoId.is_in(photo_ids.clone()))
                .exec(&txn)
                .await?
                .rows_affected;
            info!("  Deleted {deleted} face detections");

            let deleted = photo_ocr_results::Entity::delete_many()
                .filter(photo_ocr_results::Column::PhotoId.is_in(photo_ids))
                .exec(&txn)
                .await?
                .rows_affected;
            info!("  Deleted {deleted} OCR results");
        }

        // Delete albums and persons
        let deleted = photo_albums::Entity::delete_many()
            .filter(photo_albums::Column::AppId.eq(library_id))
            .exec(&txn)
            .await?
            .rows_affected;
        info!("  Deleted {deleted} albums");

        let deleted = photo_persons::Entity::delete_many()
            .filter(photo_persons::Column::AppId.eq(library_id))
            .exec(&txn)
            .await?
            .rows_affected;
        info!("  Deleted {deleted} persons");

        // Delete photos
        let deleted = photos::Entity::delete_many()
            .filter(photos::Column::AppId.eq(library_id))
            .exec(&txn)
            .await?
            .rows_affected;
        info!("  Deleted {deleted} photos");

        txn.commit().await?;
        Ok(())
    }

    /// Remote file system source types (network protocols + cloud drives).
    fn is_remote_fs_type(source_type: &str) -> bool {
        matches!(
            source_type,
            "smb" | "nfs" | "webdav" | "ftp" | "sftp" | "s3" | "115cloud" | "aliyundrive" | "baidu_netdisk" | "quark"
        )
    }

    /// Batch size for flushing accumulated jobs to the bus.
    const JOB_BATCH_FLUSH_SIZE: usize = 50;

    /// Walk a single VFS source, check DB for existing photos, create scrape jobs.
    async fn sync_fs_source(
        db: &DatabaseConnection,
        sources: &SourceRegistry,
        bus_client: &Arc<OnceLock<Arc<BusClient>>>,
        library_id: Uuid,
        source: &vfs::Model,
        root_path: &str,
        user_id: Uuid,
    ) -> Result<u64, AppError> {
        let source_type = &source.r#type;
        let is_local = source_type == "local";
        let is_remote = Self::is_remote_fs_type(source_type);

        if !is_local && !is_remote {
            warn!(
                "Unsupported source type \"{}\" for source \"{}\", skipping",
                source_type, source.name
            );
            return Ok(0);
        }

        // Get VFS handle
        let source_id_str = source.id.to_string();
        let vfs = sources.ensure_vfs(&source_id_str).await.map_err(|e| {
            AppError::Internal(format!(
                "Failed to get VFS for source {} ({}): {}",
                source.name, source_id_str, e
            ))
        })?;

        // Convert absolute root_path to VFS-relative path
        let vfs_root = to_vfs_path(root_path, source);

        // Spawn concurrent walk as a background task
        let (tx, mut rx) = mpsc::channel::<FileInfo>(256);
        let walk_root = vfs_root.clone();
        let walk_source_id = source_id_str.clone();
        let walk_handle =
            tokio::spawn(
                async move { walk_files_streaming(vfs, &walk_root, &walk_source_id, &PHOTO_EXTENSIONS, tx).await },
            );

        // Pre-load existing photo paths for this source to detect new vs changed
        let existing_photos = Self::load_existing_paths(db, library_id, source.id).await?;
        let mut seen_paths = HashSet::new();
        let mut jobs_batch: Vec<(serde_json::Value, Option<Uuid>)> = Vec::new();
        let mut total_jobs = 0u64;
        let mut skipped = 0u64;

        let client = bus_client
            .get()
            .ok_or_else(|| AppError::Internal("bus client not initialized".into()))?;

        while let Some(file) = rx.recv().await {
            seen_paths.insert(file.file_path.clone());

            let checksum = format!("{}:{}", file.file_size, file.mtime);

            // Skip if already exists with matching checksum
            if let Some(existing_checksum) = existing_photos.get(&file.file_path)
                && existing_checksum.as_deref() == Some(&checksum)
            {
                skipped += 1;
                continue;
            }

            jobs_batch.push((
                json!({
                    "filePath": file.file_path,
                    "dirPath": file.dir_path,
                    "fileSize": file.file_size,
                    "checksum": checksum,
                    "sourceId": source.id.to_string(),
                    "libType": "photo",
                    "photoLibraryId": library_id.to_string(),
                }),
                Some(user_id),
            ));

            // Flush batch periodically
            if jobs_batch.len() >= Self::JOB_BATCH_FLUSH_SIZE {
                total_jobs += Self::create_scrape_jobs(client, library_id, std::mem::take(&mut jobs_batch)).await?;
            }
        }

        // Flush remaining jobs
        if !jobs_batch.is_empty() {
            total_jobs += Self::create_scrape_jobs(client, library_id, jobs_batch).await?;
        }

        // Wait for walk to complete
        let walk_stats = walk_handle
            .await
            .map_err(|e| AppError::Internal(format!("Walk task panicked for source \"{}\": {}", source.name, e)))?
            .map_err(|e| {
                AppError::Internal(format!(
                    "Failed to walk source \"{}\" root={}: {}",
                    source.name, vfs_root, e
                ))
            })?;

        info!(
            "[{}({})] Walk done: {} dirs, {} files found, {} unchanged (skipped), {} jobs queued under \"{}\"",
            source.name, source_type, walk_stats.visited_dirs, walk_stats.found_files, skipped, total_jobs, vfs_root
        );

        // Cleanup missing photos
        Self::cleanup_missing_photos(db, library_id, source.id, &vfs_root, &seen_paths).await?;

        Ok(total_jobs)
    }

    /// Load existing photo paths and checksums for a source.
    /// Returns a map of `path -> checksum`.
    async fn load_existing_paths(
        db: &DatabaseConnection,
        library_id: Uuid,
        source_id: Uuid,
    ) -> Result<HashMap<String, Option<String>>, AppError> {
        #[derive(DerivePartialModel)]
        #[sea_orm(entity = "photos::Entity")]
        struct PhotoPath {
            pub path: String,
            pub checksum: Option<String>,
        }

        let rows = photos::Entity::find()
            .filter(photos::Column::AppId.eq(library_id))
            .filter(photos::Column::SourceId.eq(source_id))
            .filter(photos::Column::DeletedAt.is_null())
            .into_partial_model::<PhotoPath>()
            .all(db)
            .await?;

        Ok(rows.into_iter().map(|r| (r.path, r.checksum)).collect())
    }

    /// Create photo_scrape jobs via bus.
    async fn create_scrape_jobs(
        client: &BusClient,
        _library_id: Uuid,
        jobs: Vec<(serde_json::Value, Option<Uuid>)>,
    ) -> Result<u64, AppError> {
        if jobs.is_empty() {
            return Ok(0);
        }
        let mut inserted = 0u64;
        for (params, user_id) in jobs {
            let request = CreateJobRequest::new("file_scrape", params);
            jobs_client::create(
                client,
                jobs_client::photo_caller(Some(user_id.unwrap_or(Uuid::nil()))),
                request,
            )
            .await?;
            inserted += 1;
        }
        Ok(inserted)
    }

    /// Remove photos from the DB that no longer exist on disk.
    async fn cleanup_missing_photos(
        db: &DatabaseConnection,
        library_id: Uuid,
        source_id: Uuid,
        root_path: &str,
        seen_paths: &HashSet<String>,
    ) -> Result<(), AppError> {
        let normalized_root = root_path.trim_end_matches('/');
        let prefix = format!("{normalized_root}/");

        let db_photos = photos::Entity::find()
            .filter(photos::Column::AppId.eq(library_id))
            .filter(photos::Column::SourceId.eq(source_id))
            .filter(
                sea_orm::Condition::any()
                    .add(photos::Column::Path.eq(normalized_root))
                    .add(photos::Column::Path.starts_with(&prefix)),
            )
            .all(db)
            .await?;

        let stale_ids: Vec<Uuid> = db_photos
            .iter()
            .filter(|p| !seen_paths.contains(&p.path))
            .map(|p| p.id)
            .collect();

        if stale_ids.is_empty() {
            return Ok(());
        }

        info!(
            "Cleaning up {} missing photos (source={}, root={})",
            stale_ids.len(),
            source_id,
            root_path
        );

        photos::Entity::delete_many()
            .filter(photos::Column::Id.is_in(stale_ids))
            .exec(db)
            .await?;

        Ok(())
    }
}
