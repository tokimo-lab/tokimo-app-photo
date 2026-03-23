use sea_orm::sea_query::Expr;
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

    /// Create a photo album
    pub async fn create_album(
        db: &DatabaseConnection,
        library_id: Uuid,
        name: &str,
        description: Option<&str>,
    ) -> Result<PhotoAlbumOutput, AppError> {
        let album_id = Uuid::new_v4();
        let max_sort = photo_albums::Entity::find()
            .filter(photo_albums::Column::LibraryId.eq(library_id))
            .select_only()
            .column_as(photo_albums::Column::SortOrder.max(), "max_sort")
            .into_tuple::<Option<i32>>()
            .one(db)
            .await?
            .flatten()
            .unwrap_or(0);

        let active = photo_albums::ActiveModel {
            id: Set(album_id),
            library_id: Set(library_id),
            name: Set(name.to_string()),
            description: Set(description.map(|s| s.to_string())),
            album_type: Set("manual".to_string()),
            sort_order: Set(max_sort + 1),
            photo_count: Set(0),
            ..Default::default()
        };
        photo_albums::Entity::insert(active).exec(db).await?;

        photo_albums::Entity::find_by_id(album_id)
            .into_partial_model::<PhotoAlbumOutput>()
            .one(db)
            .await?
            .ok_or_else(|| AppError::Internal("Failed to read created album".into()))
    }

    /// Delete a photo album (unlinks photos but doesn't delete them)
    pub async fn delete_album(
        db: &DatabaseConnection,
        album_id: Uuid,
    ) -> Result<(), AppError> {
        photos::Entity::update_many()
            .filter(photos::Column::PhotoAlbumId.eq(album_id))
            .col_expr(
                photos::Column::PhotoAlbumId,
                Expr::value(Option::<Uuid>::None),
            )
            .exec(db)
            .await?;

        photo_albums::Entity::delete_by_id(album_id)
            .exec(db)
            .await?;
        Ok(())
    }

    /// Add photos to an album
    pub async fn add_photos_to_album(
        db: &DatabaseConnection,
        album_id: Uuid,
        photo_ids: &[Uuid],
    ) -> Result<i32, AppError> {
        photo_albums::Entity::find_by_id(album_id)
            .one(db)
            .await?
            .ok_or_else(|| AppError::NotFound("Album not found".into()))?;

        photos::Entity::update_many()
            .filter(photos::Column::Id.is_in(photo_ids.to_vec()))
            .col_expr(
                photos::Column::PhotoAlbumId,
                Expr::value(Some(album_id)),
            )
            .exec(db)
            .await?;

        let count = photos::Entity::find()
            .filter(photos::Column::PhotoAlbumId.eq(album_id))
            .count(db)
            .await? as i32;

        let mut album_active: photo_albums::ActiveModel =
            photo_albums::Entity::find_by_id(album_id)
                .one(db)
                .await?
                .ok_or_else(|| AppError::NotFound("Album not found".into()))?
                .into();
        album_active.photo_count = Set(count);

        let album = photo_albums::Entity::find_by_id(album_id)
            .one(db)
            .await?;
        if album.as_ref().and_then(|a| a.cover_photo_id).is_none() && !photo_ids.is_empty() {
            album_active.cover_photo_id = Set(Some(photo_ids[0]));
        }
        album_active.update(db).await?;

        Ok(count)
    }

    /// Remove photos from an album
    pub async fn remove_photos_from_album(
        db: &DatabaseConnection,
        album_id: Uuid,
        photo_ids: &[Uuid],
    ) -> Result<i32, AppError> {
        photos::Entity::update_many()
            .filter(photos::Column::Id.is_in(photo_ids.to_vec()))
            .filter(photos::Column::PhotoAlbumId.eq(album_id))
            .col_expr(
                photos::Column::PhotoAlbumId,
                Expr::value(Option::<Uuid>::None),
            )
            .exec(db)
            .await?;

        let count = photos::Entity::find()
            .filter(photos::Column::PhotoAlbumId.eq(album_id))
            .count(db)
            .await? as i32;

        let mut album_active: photo_albums::ActiveModel =
            photo_albums::Entity::find_by_id(album_id)
                .one(db)
                .await?
                .ok_or_else(|| AppError::NotFound("Album not found".into()))?
                .into();
        album_active.photo_count = Set(count);
        album_active.update(db).await?;

        Ok(count)
    }

    /// Batch set favorite for multiple photos
    pub async fn batch_set_favorite(
        db: &DatabaseConnection,
        photo_ids: &[Uuid],
        favorite: bool,
    ) -> Result<u64, AppError> {
        let result = photos::Entity::update_many()
            .filter(photos::Column::Id.is_in(photo_ids.to_vec()))
            .col_expr(photos::Column::IsFavorite, Expr::value(favorite))
            .exec(db)
            .await?;
        Ok(result.rows_affected)
    }

    /// Get photos that need EXIF re-scan (taken_at is NULL, have a source)
    pub async fn get_photos_needing_exif(
        db: &DatabaseConnection,
        library_id: Uuid,
    ) -> Result<Vec<(Uuid, String, Uuid)>, AppError> {
        // Return (photo_id, path, source_id) for photos missing EXIF
        let rows = photos::Entity::find()
            .filter(photos::Column::LibraryId.eq(library_id))
            .filter(photos::Column::TakenAt.is_null())
            .filter(photos::Column::SourceId.is_not_null())
            .select_only()
            .column(photos::Column::Id)
            .column(photos::Column::Path)
            .column(photos::Column::SourceId)
            .into_tuple::<(Uuid, String, Option<Uuid>)>()
            .all(db)
            .await?;

        Ok(rows
            .into_iter()
            .filter_map(|(id, path, src)| src.map(|s| (id, path, s)))
            .collect())
    }

    /// Update EXIF data for a single photo
    pub async fn update_exif(
        db: &DatabaseConnection,
        photo_id: Uuid,
        exif: &rust_image_processor::ExifData,
    ) -> Result<(), AppError> {
        let mut active = photos::ActiveModel {
            id: Set(photo_id),
            ..Default::default()
        };

        if let Some(ref date_str) = exif.taken_at {
            let cleaned = date_str.trim_matches('"');
            let normalised =
                if cleaned.len() >= 10 && &cleaned[4..5] == ":" && &cleaned[7..8] == ":" {
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
            if let Ok(dt) =
                chrono::NaiveDateTime::parse_from_str(&normalised, "%Y-%m-%d %H:%M:%S")
            {
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

        active.update(db).await?;
        Ok(())
    }

    /// List photos in a specific album
    pub async fn list_album_photos(
        db: &DatabaseConnection,
        album_id: Uuid,
        page: &PageInput,
    ) -> Result<Page<PhotoOutput>, AppError> {
        let query = photos::Entity::find()
            .filter(photos::Column::PhotoAlbumId.eq(album_id))
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
}
