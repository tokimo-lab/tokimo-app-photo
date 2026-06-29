//! Photo library sync — VFS walk + photo import orchestration.
//!
//! Ported from the monolith's `AppSyncService::do_photo_sync` / `sync_fs_source`.
//! The flow:
//!   1. Parse sources from `photo_libraries.sources` JSON
//!   2. For each source, walk VFS with `PHOTO_EXTENSIONS`
//!   3. Check existing photos in DB (by path + checksum)
//!   4. Create `photo_scrape` jobs for new/changed photos via bus
//!   5. Clean up photos that no longer exist on disk

use std::cmp;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use chrono::Utc;
use sea_orm::*;
use serde_json::json;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use tracing::{error, info, warn};
use uuid::Uuid;

use tokimo_bus_client::BusClient;

use crate::bus_clients::jobs::{self as jobs_client, CreateJobRequest, JobFilter, QueryJobsRequest};
use crate::bus_clients::person as person_bus;
use crate::config::PhotoAiSettings;
use crate::db::entities::{
    photo_albums, photo_clip_vectors, photo_faces, photo_ocr_results, photo_persons, photos, vfs,
};
use crate::error::{AppError, OptionExt};
use crate::handlers::vfs::ops::{PHOTO_EXTENSIONS, VideoFileInfo, WalkProgress, walk_files_streaming_with_progress};
use crate::queue::JobPriority;
use crate::repos::PhotoLibraryRepo;
use crate::services::source::SourceRegistry;

pub const PHOTO_LIBRARY_SYNC_JOB_TYPE: &str = "photo_library_sync";

/// Convert an absolute host path to a VFS-relative path.
fn to_vfs_path(root_path: &str, source: &vfs::Model) -> String {
    let Some(driver_root) = crate::handlers::media::utils::local_driver_root(source) else {
        return root_path.to_string();
    };
    if root_path.starts_with(&driver_root) && root_path.len() > driver_root.len() {
        let rel = &root_path[driver_root.len()..];
        if rel.starts_with('/') {
            return rel.to_string();
        }
    }
    if root_path == driver_root {
        return "/".to_string();
    }
    root_path.to_string()
}

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
    pub scanned_files: u64,
    pub skipped_files: u64,
    pub queued_jobs: u64,
    pub backfilled_checksums: u64,
    pub visited_dirs: u64,
}

#[derive(Debug, Clone)]
struct ExistingPhotoState {
    id: Uuid,
    checksum: Option<String>,
}

#[derive(Debug, Default, Clone)]
struct SourceSyncResult {
    total_jobs: u64,
    scanned_files: u64,
    skipped_files: u64,
    queued_jobs: u64,
    backfilled_checksums: u64,
    visited_dirs: u64,
}

#[derive(Clone)]
pub struct SyncJobContext {
    pub job_id: Uuid,
    pub user_id: Uuid,
    pub client: Arc<BusClient>,
    pub cancel: CancellationToken,
}

#[derive(Debug, Clone)]
struct SyncProgressSnapshot {
    phase: &'static str,
    source_path: Option<String>,
    source_index: usize,
    source_total: usize,
    visited_dirs: u64,
    scanned_files: u64,
    skipped_files: u64,
    queued_jobs: u64,
    backfilled_checksums: u64,
}

impl SyncJobContext {
    async fn check_cancelled(&self) -> Result<(), AppError> {
        if self.cancel.is_cancelled() {
            return Err(AppError::Gone("job cancelled".into()));
        }

        let response = jobs_client::query(
            &self.client,
            jobs_client::photo_caller(Some(self.user_id)),
            QueryJobsRequest {
                id: Some(self.job_id),
                ..Default::default()
            },
        )
        .await?;

        if response
            .items
            .first()
            .is_some_and(|job| matches!(job.status.as_str(), "cancelled" | "suspended"))
        {
            self.cancel.cancel();
            return Err(AppError::Gone("job cancelled".into()));
        }

        Ok(())
    }

    async fn update_sync_progress(&self, library_id: Uuid, snapshot: SyncProgressSnapshot) -> Result<(), AppError> {
        self.check_cancelled().await?;

        let data = json!({
            "phase": snapshot.phase,
            "photoLibraryId": library_id.to_string(),
            "sourcePath": snapshot.source_path,
            "sourceIndex": snapshot.source_index,
            "sourceTotal": snapshot.source_total,
            "visitedDirs": snapshot.visited_dirs,
            "scannedFiles": snapshot.scanned_files,
            "skippedFiles": snapshot.skipped_files,
            "queuedJobs": snapshot.queued_jobs,
            "backfilledChecksums": snapshot.backfilled_checksums,
        });

        jobs_client::update_progress(
            &self.client,
            jobs_client::photo_caller(Some(self.user_id)),
            self.job_id,
            0,
            Some(data),
        )
        .await?;
        Ok(())
    }
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
        sync_job: Option<&SyncJobContext>,
    ) -> Result<SyncResult, AppError> {
        let library = PhotoLibraryRepo::get_by_id(db, library_id)
            .await?
            .not_found("photo library not found")?;

        info!("Starting photo sync for \"{}\" (id={})", library.name, library_id);

        let result = Self::do_photo_sync(db, sources, bus_client, &library, clear_data, user_id, sync_job).await;

        match &result {
            Ok(sync_result) => {
                let now = Utc::now();
                PhotoLibraryRepo::update_sync_status(db, library_id, "completed", Some(now.fixed_offset())).await?;
                info!(
                    "Photo sync completed: \"{}\" — {} jobs dispatched",
                    library.name, sync_result.total_jobs
                );
                if sync_result.total_jobs > 0 {
                    let client = bus_client
                        .get()
                        .ok_or_else(|| AppError::Internal("bus client not initialized".into()))?;
                    Self::enqueue_photo_ai_jobs(db, client, library_id, user_id).await;
                }
            }
            Err(err) => {
                error!("Photo sync failed for \"{}\": {}", library.name, err);
                let status = if matches!(err, AppError::Gone(_)) {
                    "idle"
                } else {
                    "failed"
                };
                if let Err(e) = PhotoLibraryRepo::update_sync_status(db, library_id, status, None).await {
                    warn!("photo sync {library_id}: failed to mark sync_status={status}: {e}");
                }
            }
        }

        result
    }

    /// Enqueue library-level AI enhancement scans after new/changed photos are
    /// imported. This restores the monorepo auto-processing contract while
    /// keeping inference in the OS media services and the existing photo
    /// parent/child scan workers.
    pub async fn enqueue_photo_ai_jobs(db: &DatabaseConnection, client: &BusClient, library_id: Uuid, user_id: Uuid) {
        let settings = match PhotoAiSettings::for_app(db, library_id).await {
            Ok(settings) => settings,
            Err(err) => {
                warn!("[auto_ai] Failed to load AI settings for photo library {library_id}: {err}");
                return;
            }
        };

        let library = match PhotoLibraryRepo::get_by_id(db, library_id).await {
            Ok(Some(library)) => library,
            Ok(None) => {
                warn!("[auto_ai] Photo library {library_id} not found, skipping AI jobs");
                return;
            }
            Err(err) => {
                warn!("[auto_ai] Failed to load photo library {library_id}: {err}");
                return;
            }
        };
        let app_settings = library.settings.unwrap_or_else(|| json!({}));
        let auto_geo = app_settings
            .get("autoGeo")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(true);

        let scan_jobs = [
            (
                "photo_face_scan",
                "photo_face_detect",
                "autoFace",
                settings.face_enabled,
            ),
            ("photo_ocr_scan", "photo_ocr", "autoOcr", settings.ocr_enabled),
            ("photo_clip_scan", "photo_clip", "autoClip", settings.clip_enabled),
            ("photo_geocode_scan", "photo_reverse_geocode", "autoGeo", auto_geo),
        ];

        for (job_type, task_type, setting_key, enabled) in scan_jobs {
            if !enabled {
                info!("[auto_ai] Skipping {job_type}: {setting_key} disabled for photo library {library_id}");
                continue;
            }

            let mut request = CreateJobRequest::new(job_type, json!({ "photoLibraryId": library_id.to_string() }));
            request.task_type = Some(task_type.to_string());
            request.dedupe_key = Some(format!("photo:{library_id}:{job_type}"));
            request.priority = Some(JobPriority::Background.as_i32());

            match jobs_client::enqueue_with_dedupe(client, jobs_client::photo_caller(Some(user_id)), request).await {
                Ok(job) => info!(
                    "[auto_ai] Enqueued {job_type} for photo library {library_id} as job {}",
                    job.id
                ),
                Err(err) => warn!("[auto_ai] Failed to enqueue {job_type} for photo library {library_id}: {err}"),
            }
        }
    }

    /// Core photo sync logic.
    async fn do_photo_sync(
        db: &DatabaseConnection,
        sources: &SourceRegistry,
        bus_client: &Arc<OnceLock<Arc<BusClient>>>,
        library: &crate::db::entities::photo_libraries::Model,
        clear_data: bool,
        user_id: Uuid,
        sync_job: Option<&SyncJobContext>,
    ) -> Result<SyncResult, AppError> {
        let library_id = library.id;

        let client = bus_client
            .get()
            .ok_or_else(|| AppError::Internal("bus client not initialized".into()))?;

        if clear_data {
            if let Some(job) = sync_job {
                job.update_sync_progress(
                    library_id,
                    SyncProgressSnapshot {
                        phase: "clearing",
                        source_path: None,
                        source_index: 0,
                        source_total: 0,
                        visited_dirs: 0,
                        scanned_files: 0,
                        skipped_files: 0,
                        queued_jobs: 0,
                        backfilled_checksums: 0,
                    },
                )
                .await?;
            }
            Self::clear_library_data_with_person_sync(db, client, library_id, user_id).await?;
        }

        // Clean up old finished jobs
        let filter = photo_library_filter(library_id, None);
        let _ = jobs_client::cleanup(client, jobs_client::photo_caller(Some(user_id)), filter).await;

        let source_tuples = PhotoLibraryRepo::parse_sources(&library.sources);
        if source_tuples.is_empty() {
            info!("  No sources configured for photo library, skipping");
            return Ok(SyncResult {
                total_jobs: 0,
                scanned_files: 0,
                skipped_files: 0,
                queued_jobs: 0,
                backfilled_checksums: 0,
                visited_dirs: 0,
            });
        }

        let mut result = SyncResult {
            total_jobs: 0,
            scanned_files: 0,
            skipped_files: 0,
            queued_jobs: 0,
            backfilled_checksums: 0,
            visited_dirs: 0,
        };

        for (index, (source_id, root_path, _is_default)) in source_tuples.iter().enumerate() {
            let source = vfs::Entity::find_by_id(*source_id)
                .one(db)
                .await?
                .ok_or_else(|| AppError::NotFound(format!("source {source_id} not found")))?;

            let source_result = Self::sync_fs_source(
                db,
                sources,
                bus_client,
                library_id,
                &source,
                root_path,
                user_id,
                sync_job,
                index + 1,
                source_tuples.len(),
            )
            .await?;
            result.total_jobs += source_result.total_jobs;
            result.scanned_files += source_result.scanned_files;
            result.skipped_files += source_result.skipped_files;
            result.queued_jobs += source_result.queued_jobs;
            result.backfilled_checksums += source_result.backfilled_checksums;
            result.visited_dirs += source_result.visited_dirs;
        }

        if let Some(job) = sync_job {
            job.update_sync_progress(
                library_id,
                SyncProgressSnapshot {
                    phase: "completed",
                    source_path: None,
                    source_index: source_tuples.len(),
                    source_total: source_tuples.len(),
                    visited_dirs: result.visited_dirs,
                    scanned_files: result.scanned_files,
                    skipped_files: result.skipped_files,
                    queued_jobs: result.queued_jobs,
                    backfilled_checksums: result.backfilled_checksums,
                },
            )
            .await?;
        }

        Ok(result)
    }

    /// Clear all photo data for a library, including derived tables.
    pub async fn clear_library_data(db: &DatabaseConnection, library_id: Uuid) -> Result<(), AppError> {
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

    /// Clear local photo data and remove corresponding source registrations
    /// from the shared person app cache.
    pub async fn clear_library_data_with_person_sync(
        db: &DatabaseConnection,
        bus_client: &BusClient,
        library_id: Uuid,
        user_id: Uuid,
    ) -> Result<(), AppError> {
        let photo_ids = Self::library_photo_ids(db, library_id).await?;

        Self::clear_library_data(db, library_id).await?;
        Self::delete_person_sources_for_photos(bus_client, user_id, &photo_ids).await?;

        Ok(())
    }

    async fn library_photo_ids(db: &DatabaseConnection, library_id: Uuid) -> Result<Vec<Uuid>, AppError> {
        Ok(photos::Entity::find()
            .filter(photos::Column::AppId.eq(library_id))
            .select_only()
            .column(photos::Column::Id)
            .into_tuple::<Uuid>()
            .all(db)
            .await?)
    }

    async fn delete_person_sources_for_photos(
        bus_client: &BusClient,
        user_id: Uuid,
        photo_ids: &[Uuid],
    ) -> Result<(), AppError> {
        if photo_ids.is_empty() {
            return Ok(());
        }

        info!(
            "Deleting {} person source registrations for cleared photo library",
            photo_ids.len()
        );

        for photo_id in photo_ids {
            let source_id = photo_id.to_string();
            let caller = person_bus::photo_caller(Some(user_id));

            match person_bus::delete_source(bus_client, caller, "photo", &source_id).await {
                Ok(()) => {}
                Err(err) => {
                    warn!("person.delete_source failed for photo {photo_id}; creating retry job: {err}");
                    person_bus::delete_source_via_job(
                        bus_client,
                        person_bus::photo_caller(Some(user_id)),
                        "photo",
                        &source_id,
                    )
                    .await?;
                }
            }
        }

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
        sync_job: Option<&SyncJobContext>,
        source_index: usize,
        source_total: usize,
    ) -> Result<SourceSyncResult, AppError> {
        let source_type = &source.r#type;
        let is_local = source_type == "local";
        let is_remote = Self::is_remote_fs_type(source_type);

        if !is_local && !is_remote {
            warn!(
                "Unsupported source type \"{}\" for source \"{}\", skipping",
                source_type, source.name
            );
            return Ok(SourceSyncResult::default());
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
        let (tx, mut rx) = mpsc::channel::<VideoFileInfo>(256);
        let (progress_tx, mut progress_rx) = mpsc::channel::<WalkProgress>(16);
        let walk_root = vfs_root.clone();
        let walk_source_id = source_id_str.clone();
        let cancel = sync_job.map(|job| job.cancel.clone());
        let walk_handle = tokio::spawn(async move {
            walk_files_streaming_with_progress(
                vfs,
                &walk_root,
                &walk_source_id,
                &PHOTO_EXTENSIONS,
                tx,
                Some(progress_tx),
                cancel,
            )
            .await
        });

        // Pre-load existing photo paths for this source to detect new vs changed
        let existing_photos = Self::load_existing_paths(db, library_id, source.id).await?;
        let mut seen_paths = HashSet::new();
        let mut jobs_batch: Vec<(serde_json::Value, Option<Uuid>)> = Vec::new();
        let mut total_jobs = 0u64;
        let mut skipped = 0u64;
        let mut backfilled = 0u64;
        let mut scanned_files = 0u64;
        let mut visited_dirs = 0u64;
        let mut last_progress_emit = Instant::now()
            .checked_sub(Duration::from_secs(5))
            .unwrap_or_else(Instant::now);

        let client = bus_client
            .get()
            .ok_or_else(|| AppError::Internal("bus client not initialized".into()))?;

        if let Some(job) = sync_job {
            job.update_sync_progress(
                library_id,
                SyncProgressSnapshot {
                    phase: "walking",
                    source_path: Some(root_path.to_string()),
                    source_index,
                    source_total,
                    visited_dirs,
                    scanned_files,
                    skipped_files: skipped,
                    queued_jobs: total_jobs,
                    backfilled_checksums: backfilled,
                },
            )
            .await?;
        }

        let mut files_open = true;
        let mut progress_open = true;

        while files_open || progress_open {
            tokio::select! {
                maybe_file = rx.recv(), if files_open => {
                    let Some(file) = maybe_file else {
                        files_open = false;
                        continue;
                    };
                    scanned_files += 1;
                    Self::handle_discovered_file(
                        db,
                        library_id,
                        source.id,
                        user_id,
                        &existing_photos,
                        &mut seen_paths,
                        &mut jobs_batch,
                        &mut skipped,
                        &mut backfilled,
                        file,
                    )
                    .await?;

                    if jobs_batch.len() >= Self::JOB_BATCH_FLUSH_SIZE {
                        let inserted = Self::create_scrape_jobs(client, library_id, std::mem::take(&mut jobs_batch)).await?;
                        total_jobs += inserted;
                    }
                }
                maybe_progress = progress_rx.recv(), if progress_open => {
                    let Some(progress) = maybe_progress else {
                        progress_open = false;
                        continue;
                    };
                    visited_dirs = progress.visited_dirs as u64;
                    scanned_files = cmp::max(scanned_files, progress.found_videos as u64);
                }
            }

            if let Some(job) = sync_job
                && last_progress_emit.elapsed() >= Duration::from_secs(2)
            {
                job.update_sync_progress(
                    library_id,
                    SyncProgressSnapshot {
                        phase: "walking",
                        source_path: Some(root_path.to_string()),
                        source_index,
                        source_total,
                        visited_dirs,
                        scanned_files,
                        skipped_files: skipped,
                        queued_jobs: total_jobs + jobs_batch.len() as u64,
                        backfilled_checksums: backfilled,
                    },
                )
                .await?;
                last_progress_emit = Instant::now();
            }
        }

        // Flush remaining jobs
        if !jobs_batch.is_empty() {
            total_jobs += Self::create_scrape_jobs(client, library_id, jobs_batch).await?;
        }

        if let Some(job) = sync_job {
            job.update_sync_progress(
                library_id,
                SyncProgressSnapshot {
                    phase: "enqueueing",
                    source_path: Some(root_path.to_string()),
                    source_index,
                    source_total,
                    visited_dirs,
                    scanned_files,
                    skipped_files: skipped,
                    queued_jobs: total_jobs,
                    backfilled_checksums: backfilled,
                },
            )
            .await?;
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

        visited_dirs = walk_stats.visited_dirs as u64;
        scanned_files = cmp::max(scanned_files, walk_stats.found_videos as u64);

        info!(
            "[{}({})] Walk done: {} dirs, {} files found, {} unchanged (skipped), {} jobs queued under \"{}\"",
            source.name, source_type, walk_stats.visited_dirs, walk_stats.found_videos, skipped, total_jobs, vfs_root
        );

        // Cleanup missing photos
        Self::cleanup_missing_photos(db, library_id, source.id, &vfs_root, &seen_paths).await?;

        Ok(SourceSyncResult {
            total_jobs,
            scanned_files,
            skipped_files: skipped,
            queued_jobs: total_jobs,
            backfilled_checksums: backfilled,
            visited_dirs,
        })
    }

    async fn handle_discovered_file(
        db: &DatabaseConnection,
        library_id: Uuid,
        source_id: Uuid,
        user_id: Uuid,
        existing_photos: &HashMap<String, ExistingPhotoState>,
        seen_paths: &mut HashSet<String>,
        jobs_batch: &mut Vec<(serde_json::Value, Option<Uuid>)>,
        skipped: &mut u64,
        backfilled: &mut u64,
        file: VideoFileInfo,
    ) -> Result<(), AppError> {
        seen_paths.insert(file.file_path.clone());

        let checksum = format!("{}:{}", file.file_size, file.mtime);

        if let Some(existing) = existing_photos.get(&file.file_path) {
            if existing.checksum.as_deref() == Some(&checksum) {
                *skipped += 1;
                return Ok(());
            }

            if existing.checksum.is_none() {
                Self::backfill_photo_checksum(db, existing.id, &checksum).await?;
                *skipped += 1;
                *backfilled += 1;
                return Ok(());
            }
        }

        jobs_batch.push((
            json!({
                "filePath": file.file_path,
                "dirPath": file.dir_path,
                "fileSize": file.file_size,
                "fileCreatedAt": file.created,
                "checksum": checksum,
                "sourceId": source_id.to_string(),
                "libType": "photo",
                "photoId": library_id.to_string(),
                "photoLibraryId": library_id.to_string(),
            }),
            Some(user_id),
        ));
        Ok(())
    }

    /// Load existing photo paths and checksums for a source.
    /// Returns a map of `path -> existing photo state`.
    async fn load_existing_paths(
        db: &DatabaseConnection,
        library_id: Uuid,
        source_id: Uuid,
    ) -> Result<HashMap<String, ExistingPhotoState>, AppError> {
        #[derive(DerivePartialModel)]
        #[sea_orm(entity = "photos::Entity")]
        struct PhotoPath {
            pub id: Uuid,
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

        Ok(rows
            .into_iter()
            .map(|r| {
                (
                    r.path,
                    ExistingPhotoState {
                        id: r.id,
                        checksum: r.checksum,
                    },
                )
            })
            .collect())
    }

    async fn backfill_photo_checksum(db: &DatabaseConnection, photo_id: Uuid, checksum: &str) -> Result<(), AppError> {
        let now = Utc::now().fixed_offset();
        let active = photos::ActiveModel {
            id: Set(photo_id),
            checksum: Set(Some(checksum.to_string())),
            updated_at: Set(Some(now)),
            ..Default::default()
        };
        active.update(db).await?;
        Ok(())
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
