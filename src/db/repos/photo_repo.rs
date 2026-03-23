use sea_orm::*;
use uuid::Uuid;

use crate::db::entities::{file_systems, photo_albums, photos};
use crate::db::models::photo::{FolderInfo, PhotoAlbumOutput, PhotoDetailOutput, PhotoOutput, PhotoStreamTarget};
use crate::db::pagination::{Page, PageInput};
use crate::error::AppError;

pub struct PhotoRepo;

impl PhotoRepo {
    /// List photos with pagination, sorting, and optional search
    pub async fn list(
        db: &DatabaseConnection,
        library_id: Uuid,
        page: &PageInput,
        sort_by: &str,
        sort_dir: &str,
        search: Option<&str>,
        favorites_only: bool,
    ) -> Result<Page<PhotoOutput>, AppError> {
        let mut query = photos::Entity::find()
            .filter(photos::Column::LibraryId.eq(library_id))
            .filter(photos::Column::IsHidden.eq(false));

        if favorites_only {
            query = query.filter(photos::Column::IsFavorite.eq(true));
        }

        if let Some(s) = search {
            if !s.is_empty() {
                let pattern = format!("%{s}%");
                query = query.filter(
                    sea_orm::sea_query::Condition::any()
                        .add(photos::Column::Filename.like(&pattern))
                        .add(photos::Column::Title.like(&pattern))
                        .add(photos::Column::CameraMake.like(&pattern))
                        .add(photos::Column::CameraModel.like(&pattern)),
                );
            }
        }

        // Sorting
        query = match sort_by {
            "takenAt" => match sort_dir {
                "asc" => query.order_by_asc(photos::Column::TakenAt),
                _ => query.order_by_desc(photos::Column::TakenAt),
            },
            "filename" => match sort_dir {
                "desc" => query.order_by_desc(photos::Column::Filename),
                _ => query.order_by_asc(photos::Column::Filename),
            },
            "fileSize" => match sort_dir {
                "asc" => query.order_by_asc(photos::Column::FileSize),
                _ => query.order_by_desc(photos::Column::FileSize),
            },
            // Default: newest first by taken_at, then created_at
            _ => query
                .order_by_desc(photos::Column::TakenAt)
                .order_by_desc(photos::Column::CreatedAt),
        };

        let total = query.clone().count(db).await? as i64;
        let items = query
            .into_partial_model::<PhotoOutput>()
            .paginate(db, page.page_size)
            .fetch_page(page.page.saturating_sub(1))
            .await?;

        Ok(Page::new(items, total, page))
    }

    /// Get photo by ID with full detail
    pub async fn get_by_id(
        db: &DatabaseConnection,
        photo_id: Uuid,
    ) -> Result<Option<PhotoDetailOutput>, AppError> {
        let model = photos::Entity::find_by_id(photo_id).one(db).await?;
        Ok(model.map(PhotoDetailOutput::from))
    }

    /// Toggle favorite
    pub async fn toggle_favorite(
        db: &DatabaseConnection,
        photo_id: Uuid,
    ) -> Result<bool, AppError> {
        let photo = photos::Entity::find_by_id(photo_id)
            .one(db)
            .await?
            .ok_or_else(|| AppError::NotFound("Photo not found".into()))?;

        let new_val = !photo.is_favorite;
        let mut active: photos::ActiveModel = photo.into();
        active.is_favorite = Set(new_val);
        active.update(db).await?;
        Ok(new_val)
    }

    /// List photo albums
    pub async fn list_albums(
        db: &DatabaseConnection,
        library_id: Uuid,
    ) -> Result<Vec<PhotoAlbumOutput>, AppError> {
        let items = photo_albums::Entity::find()
            .filter(photo_albums::Column::LibraryId.eq(library_id))
            .order_by_asc(photo_albums::Column::SortOrder)
            .into_partial_model::<PhotoAlbumOutput>()
            .all(db)
            .await?;
        Ok(items)
    }

    /// Get timeline data — photos grouped by date
    pub async fn timeline(
        db: &DatabaseConnection,
        library_id: Uuid,
        page: &PageInput,
    ) -> Result<Page<PhotoOutput>, AppError> {
        let query = photos::Entity::find()
            .filter(photos::Column::LibraryId.eq(library_id))
            .filter(photos::Column::IsHidden.eq(false))
            .order_by_desc(photos::Column::TakenAt)
            .order_by_desc(photos::Column::CreatedAt);

        let total = query.clone().count(db).await? as i64;
        let items = query
            .into_partial_model::<PhotoOutput>()
            .paginate(db, page.page_size)
            .fetch_page(page.page.saturating_sub(1))
            .await?;

        Ok(Page::new(items, total, page))
    }

    /// Load the minimal info needed to stream a photo file via VFS.
    pub async fn load_stream_target(
        db: &DatabaseConnection,
        photo_id: &str,
    ) -> Result<Option<PhotoStreamTarget>, AppError> {
        let pid: Uuid = photo_id
            .parse()
            .map_err(|_| AppError::BadRequest("invalid photo id".into()))?;
        let row = photos::Entity::find_by_id(pid)
            .find_also_related(file_systems::Entity)
            .one(db)
            .await?;

        Ok(row.map(|(photo, fs)| {
            let (source_type, source_config) = match fs {
                Some(s) => (Some(s.r#type), s.config),
                None => (None, None),
            };
            PhotoStreamTarget {
                path: photo.path,
                mime_type: photo.mime_type,
                thumbnail_path: photo.thumbnail_path,
                source_id: photo.source_id.map(|id| id.to_string()),
                source_type,
                source_config,
            }
        }))
    }

    /// List subdirectories and photos within a specific directory path.
    pub async fn list_folders(
        db: &DatabaseConnection,
        library_id: Uuid,
        dir_path: &str,
    ) -> Result<(Vec<FolderInfo>, Vec<PhotoOutput>), AppError> {
        use std::collections::BTreeMap;

        let prefix = if dir_path.is_empty() || dir_path == "/" {
            "/".to_string()
        } else {
            let p = dir_path.trim_end_matches('/');
            format!("{p}/")
        };

        let all_photos = photos::Entity::find()
            .filter(photos::Column::LibraryId.eq(library_id))
            .filter(photos::Column::IsHidden.eq(false))
            .filter(photos::Column::Path.starts_with(&prefix))
            .order_by_asc(photos::Column::Filename)
            .into_partial_model::<PhotoOutput>()
            .all(db)
            .await?;

        let mut subdirs: BTreeMap<String, (i64, Option<String>)> = BTreeMap::new();
        let mut direct_photos: Vec<PhotoOutput> = Vec::new();

        for photo in all_photos {
            let remainder = match photo.path.get(prefix.len()..) {
                Some(r) => r,
                None => continue,
            };

            if let Some(slash_pos) = remainder.find('/') {
                let dir_name = &remainder[..slash_pos];
                let entry = subdirs.entry(dir_name.to_string()).or_insert((0, None));
                entry.0 += 1;
                if entry.1.is_none() {
                    entry.1 = Some(photo.id.to_string());
                }
            } else {
                direct_photos.push(photo);
            }
        }

        let folders: Vec<FolderInfo> = subdirs
            .into_iter()
            .map(|(name, (count, cover_id))| FolderInfo {
                path: format!("{prefix}{name}"),
                name,
                photo_count: count,
                cover_photo_id: cover_id,
            })
            .collect();

        Ok((folders, direct_photos))
    }

    /// Count photos in library
    pub async fn count(
        db: &DatabaseConnection,
        library_id: Uuid,
    ) -> Result<u64, AppError> {
        let count = photos::Entity::find()
            .filter(photos::Column::LibraryId.eq(library_id))
            .count(db)
            .await?;
        Ok(count)
    }
}
