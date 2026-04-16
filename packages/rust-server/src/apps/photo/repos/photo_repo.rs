use chrono::NaiveDate;
use sea_orm::sea_query::Expr;
use sea_orm::*;
use uuid::Uuid;

use crate::apps::photo::models::{FolderInfo, PhotoAlbumOutput, PhotoDetailOutput, PhotoOutput, PhotoStreamTarget};
use crate::db::entities::{photo_albums, photos, vfs};
use crate::db::pagination::{Page, PageInput};
use crate::error::AppError;
use crate::error::OptionExt;

#[derive(Debug, serde::Serialize)]
pub struct TimelineEntry {
    pub year: i32,
    pub month: i32,
    pub day: i32,
    pub count: i64,
}

#[derive(Debug, serde::Serialize, DerivePartialModel)]
#[sea_orm(entity = "photos::Entity")]
pub struct PhotoMapPoint {
    pub id: Uuid,
    #[serde(rename = "lat")]
    pub gps_latitude: Option<f64>,
    #[serde(rename = "lng")]
    pub gps_longitude: Option<f64>,
    #[serde(rename = "city")]
    pub geo_city: Option<String>,
}

/// Input for listing photos.
#[derive(Debug)]
pub struct ListPhotosInput {
    pub app_id: Uuid,
    pub page: PageInput,
    pub sort_by: String,
    pub sort_dir: String,
    pub search: Option<String>,
    pub favorites_only: bool,
    pub before_date: Option<String>,
    pub after_date: Option<String>,
}

pub struct PhotoRepo;

impl PhotoRepo {
    /// List photos with pagination, sorting, and optional search
    pub async fn list(db: &DatabaseConnection, input: ListPhotosInput) -> Result<Page<PhotoOutput>, AppError> {
        let mut query = photos::Entity::find()
            .filter(photos::Column::AppId.eq(input.app_id))
            .filter(photos::Column::IsHidden.eq(false))
            .filter(photos::Column::DeletedAt.is_null());

        if input.favorites_only {
            query = query.filter(photos::Column::IsFavorite.eq(true));
        }

        // Date filter: show only photos taken before (or on) this date
        if let Some(date_str) = input.before_date
            && let Ok(dt) = NaiveDate::parse_from_str(&date_str, "%Y-%m-%d")
        {
            let end_of_day = dt.and_hms_opt(23, 59, 59).unwrap().and_utc().fixed_offset();
            query = query.filter(photos::Column::TakenAt.lte(end_of_day));
        }

        // Date filter: show only photos taken after (or on) this date
        if let Some(date_str) = input.after_date
            && let Ok(dt) = NaiveDate::parse_from_str(&date_str, "%Y-%m-%d")
        {
            let start_of_day = dt.and_hms_opt(0, 0, 0).unwrap().and_utc().fixed_offset();
            query = query.filter(photos::Column::TakenAt.gte(start_of_day));
        }

        if let Some(s) = input.search
            && !s.is_empty()
        {
            let pattern = format!("%{s}%");
            query = query.filter(
                sea_orm::sea_query::Condition::any()
                    .add(photos::Column::Filename.like(&pattern))
                    .add(photos::Column::Title.like(&pattern))
                    .add(photos::Column::CameraMake.like(&pattern))
                    .add(photos::Column::CameraModel.like(&pattern)),
            );
        }

        // Sorting
        query = match input.sort_by.as_str() {
            "takenAt" => match input.sort_dir.as_str() {
                "asc" => query.order_by_asc(photos::Column::TakenAt),
                _ => query.order_by_desc(photos::Column::TakenAt),
            },
            "filename" => match input.sort_dir.as_str() {
                "desc" => query.order_by_desc(photos::Column::Filename),
                _ => query.order_by_asc(photos::Column::Filename),
            },
            "fileSize" => match input.sort_dir.as_str() {
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
            .paginate(db, input.page.page_size)
            .fetch_page(input.page.page.saturating_sub(1))
            .await?;

        Ok(Page::new(items, total, &input.page))
    }

    /// Get photo by ID with full detail
    pub async fn get_by_id(db: &DatabaseConnection, photo_id: Uuid) -> Result<Option<PhotoDetailOutput>, AppError> {
        let model = photos::Entity::find_by_id(photo_id).one(db).await?;
        Ok(model.map(PhotoDetailOutput::from))
    }

    /// Toggle favorite
    pub async fn toggle_favorite(db: &DatabaseConnection, photo_id: Uuid) -> Result<bool, AppError> {
        let photo = photos::Entity::find_by_id(photo_id)
            .one(db)
            .await?
            .not_found("Photo not found")?;

        let new_val = !photo.is_favorite;
        let mut active: photos::ActiveModel = photo.into();
        active.is_favorite = Set(new_val);
        active.update(db).await?;
        Ok(new_val)
    }

    /// List photo albums
    pub async fn list_albums(db: &DatabaseConnection, app_id: Uuid) -> Result<Vec<PhotoAlbumOutput>, AppError> {
        let items = photo_albums::Entity::find()
            .filter(photo_albums::Column::AppId.eq(app_id))
            .order_by_asc(photo_albums::Column::SortOrder)
            .into_partial_model::<PhotoAlbumOutput>()
            .all(db)
            .await?;
        Ok(items)
    }

    /// Get timeline data — photos grouped by date
    pub async fn timeline(
        db: &DatabaseConnection,
        app_id: Uuid,
        page: &PageInput,
    ) -> Result<Page<PhotoOutput>, AppError> {
        let query = photos::Entity::find()
            .filter(photos::Column::AppId.eq(app_id))
            .filter(photos::Column::IsHidden.eq(false))
            .filter(photos::Column::DeletedAt.is_null())
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
            .find_also_related(vfs::Entity)
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
                live_video_path: photo.live_video_path,
                source_id: photo.source_id.map(|id| id.to_string()),
                source_type,
                source_config,
            }
        }))
    }

    /// List subdirectories and photos within a specific directory path.
    pub async fn list_folders(
        db: &DatabaseConnection,
        app_id: Uuid,
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
            .filter(photos::Column::AppId.eq(app_id))
            .filter(photos::Column::IsHidden.eq(false))
            .filter(photos::Column::DeletedAt.is_null())
            .filter(photos::Column::Path.starts_with(&prefix))
            .order_by_asc(photos::Column::Filename)
            .into_partial_model::<PhotoOutput>()
            .all(db)
            .await?;

        let mut subdirs: BTreeMap<String, (i64, Option<String>)> = BTreeMap::new();
        let mut direct_photos: Vec<PhotoOutput> = Vec::new();

        for photo in all_photos {
            let Some(remainder) = photo.path.get(prefix.len()..) else {
                continue;
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

    /// Count photos in app
    pub async fn count(db: &DatabaseConnection, app_id: Uuid) -> Result<u64, AppError> {
        let count = photos::Entity::find()
            .filter(photos::Column::AppId.eq(app_id))
            .count(db)
            .await?;
        Ok(count)
    }

    /// Create a photo album
    pub async fn create_album(
        db: &DatabaseConnection,
        app_id: Uuid,
        name: &str,
        description: Option<&str>,
    ) -> Result<PhotoAlbumOutput, AppError> {
        let album_id = Uuid::new_v4();
        let max_sort = photo_albums::Entity::find()
            .filter(photo_albums::Column::AppId.eq(app_id))
            .select_only()
            .column_as(photo_albums::Column::SortOrder.max(), "max_sort")
            .into_tuple::<Option<i32>>()
            .one(db)
            .await?
            .flatten()
            .unwrap_or(0);

        let active = photo_albums::ActiveModel {
            id: Set(album_id),
            app_id: Set(app_id),
            name: Set(name.to_string()),
            description: Set(description.map(std::string::ToString::to_string)),
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
            .internal("Failed to read created album")
    }

    /// Delete a photo album (unlinks photos but doesn't delete them)
    pub async fn delete_album(db: &DatabaseConnection, album_id: Uuid) -> Result<(), AppError> {
        photos::Entity::update_many()
            .filter(photos::Column::PhotoAlbumId.eq(album_id))
            .col_expr(photos::Column::PhotoAlbumId, Expr::value(Option::<Uuid>::None))
            .exec(db)
            .await?;

        photo_albums::Entity::delete_by_id(album_id).exec(db).await?;
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
            .not_found("Album not found")?;

        photos::Entity::update_many()
            .filter(photos::Column::Id.is_in(photo_ids.to_vec()))
            .col_expr(photos::Column::PhotoAlbumId, Expr::value(Some(album_id)))
            .exec(db)
            .await?;

        let count = photos::Entity::find()
            .filter(photos::Column::PhotoAlbumId.eq(album_id))
            .count(db)
            .await? as i32;

        let mut album_active: photo_albums::ActiveModel = photo_albums::Entity::find_by_id(album_id)
            .one(db)
            .await?
            .not_found("Album not found")?
            .into();
        album_active.photo_count = Set(count);

        let album = photo_albums::Entity::find_by_id(album_id).one(db).await?;
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
            .col_expr(photos::Column::PhotoAlbumId, Expr::value(Option::<Uuid>::None))
            .exec(db)
            .await?;

        let count = photos::Entity::find()
            .filter(photos::Column::PhotoAlbumId.eq(album_id))
            .count(db)
            .await? as i32;

        let mut album_active: photo_albums::ActiveModel = photo_albums::Entity::find_by_id(album_id)
            .one(db)
            .await?
            .not_found("Album not found")?
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

    /// Batch delete photos by IDs within an app
    pub async fn batch_delete(db: &DatabaseConnection, app_id: Uuid, photo_ids: &[Uuid]) -> Result<u64, AppError> {
        let result = photos::Entity::delete_many()
            .filter(photos::Column::AppId.eq(app_id))
            .filter(photos::Column::Id.is_in(photo_ids.to_vec()))
            .exec(db)
            .await?;
        Ok(result.rows_affected)
    }

    /// Toggle hidden flag on a photo
    pub async fn toggle_hidden(db: &DatabaseConnection, photo_id: Uuid) -> Result<bool, AppError> {
        let photo = photos::Entity::find_by_id(photo_id)
            .one(db)
            .await?
            .not_found("Photo not found")?;

        let new_val = !photo.is_hidden;
        let mut active: photos::ActiveModel = photo.into();
        active.is_hidden = Set(new_val);
        active.update(db).await?;
        Ok(new_val)
    }

    /// Batch set hidden for multiple photos
    pub async fn batch_set_hidden(db: &DatabaseConnection, photo_ids: &[Uuid], hidden: bool) -> Result<u64, AppError> {
        let result = photos::Entity::update_many()
            .filter(photos::Column::Id.is_in(photo_ids.to_vec()))
            .col_expr(photos::Column::IsHidden, Expr::value(hidden))
            .exec(db)
            .await?;
        Ok(result.rows_affected)
    }

    /// Update photo metadata (title, description, `taken_at`)
    pub async fn update_photo(
        db: &DatabaseConnection,
        photo_id: Uuid,
        title: Option<Option<String>>,
        description: Option<Option<String>>,
        taken_at: Option<Option<chrono::DateTime<chrono::FixedOffset>>>,
    ) -> Result<PhotoDetailOutput, AppError> {
        let photo = photos::Entity::find_by_id(photo_id)
            .one(db)
            .await?
            .not_found("Photo not found")?;

        let mut active: photos::ActiveModel = photo.into();
        if let Some(v) = title {
            active.title = Set(v);
        }
        if let Some(v) = description {
            active.description = Set(v);
        }
        if let Some(v) = taken_at {
            active.taken_at = Set(v);
        }
        let updated = active.update(db).await?;
        Ok(PhotoDetailOutput::from(updated))
    }

    /// Soft-delete (trash) photos by setting `deleted_at`
    pub async fn trash_photos(db: &DatabaseConnection, app_id: Uuid, photo_ids: &[Uuid]) -> Result<u64, AppError> {
        let now = chrono::Utc::now().fixed_offset();
        let result = photos::Entity::update_many()
            .filter(photos::Column::AppId.eq(app_id))
            .filter(photos::Column::Id.is_in(photo_ids.to_vec()))
            .filter(photos::Column::DeletedAt.is_null())
            .col_expr(photos::Column::DeletedAt, Expr::value(now))
            .exec(db)
            .await?;
        Ok(result.rows_affected)
    }

    /// Restore photos from trash by clearing `deleted_at`
    pub async fn restore_photos(db: &DatabaseConnection, app_id: Uuid, photo_ids: &[Uuid]) -> Result<u64, AppError> {
        let result = photos::Entity::update_many()
            .filter(photos::Column::AppId.eq(app_id))
            .filter(photos::Column::Id.is_in(photo_ids.to_vec()))
            .filter(photos::Column::DeletedAt.is_not_null())
            .col_expr(
                photos::Column::DeletedAt,
                Expr::value(Option::<chrono::DateTime<chrono::FixedOffset>>::None),
            )
            .exec(db)
            .await?;
        Ok(result.rows_affected)
    }

    /// List trashed photos (`deleted_at` IS NOT NULL)
    pub async fn list_trashed(
        db: &DatabaseConnection,
        app_id: Uuid,
        page: &PageInput,
    ) -> Result<Page<PhotoOutput>, AppError> {
        let query = photos::Entity::find()
            .filter(photos::Column::AppId.eq(app_id))
            .filter(photos::Column::DeletedAt.is_not_null())
            .order_by_desc(photos::Column::DeletedAt);

        let total = query.clone().count(db).await? as i64;
        let items = query
            .into_partial_model::<PhotoOutput>()
            .paginate(db, page.page_size)
            .fetch_page(page.page.saturating_sub(1))
            .await?;

        Ok(Page::new(items, total, page))
    }

    /// Permanently delete photos that are already trashed
    pub async fn permanent_delete(db: &DatabaseConnection, app_id: Uuid, photo_ids: &[Uuid]) -> Result<u64, AppError> {
        let result = photos::Entity::delete_many()
            .filter(photos::Column::AppId.eq(app_id))
            .filter(photos::Column::Id.is_in(photo_ids.to_vec()))
            .filter(photos::Column::DeletedAt.is_not_null())
            .exec(db)
            .await?;
        Ok(result.rows_affected)
    }

    /// Get all photos with a source for full rescan
    pub async fn get_all_photos_for_rescan(
        db: &DatabaseConnection,
        app_id: Uuid,
    ) -> Result<Vec<(Uuid, String, Uuid)>, AppError> {
        let rows = photos::Entity::find()
            .filter(photos::Column::AppId.eq(app_id))
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
            if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(&normalised, "%Y-%m-%d %H:%M:%S") {
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

        // Save full raw EXIF as JSON
        if !exif.raw_tags.is_empty() {
            active.exif_data = Set(Some(serde_json::to_value(&exif.raw_tags).unwrap_or_default()));
        }

        active.update(db).await?;
        Ok(())
    }

    /// Update only the `taken_at` field (from filename date or mtime).
    /// `date_str` must be `"YYYY-MM-DD HH:MM:SS"`.
    pub async fn update_taken_at(db: &DatabaseConnection, photo_id: Uuid, date_str: &str) -> Result<(), AppError> {
        if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(date_str, "%Y-%m-%d %H:%M:%S") {
            let mut active = photos::ActiveModel {
                id: Set(photo_id),
                ..Default::default()
            };
            active.taken_at = Set(Some(dt.and_utc().fixed_offset()));
            active.update(db).await?;
        }
        Ok(())
    }

    /// Update only width/height (when EXIF didn't have dimensions but image header did).
    pub async fn update_exif_dimensions(
        db: &DatabaseConnection,
        photo_id: Uuid,
        width: i32,
        height: i32,
    ) -> Result<(), AppError> {
        let active = photos::ActiveModel {
            id: Set(photo_id),
            width: Set(Some(width)),
            height: Set(Some(height)),
            ..Default::default()
        };
        active.update(db).await?;
        Ok(())
    }

    /// Get timeline index: year/month counts for an app (all photos, not paginated)
    pub async fn timeline_index(db: &DatabaseConnection, app_id: Uuid) -> Result<Vec<TimelineEntry>, AppError> {
        let stmt = Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r"
            SELECT
                EXTRACT(YEAR FROM taken_at)::int AS year,
                EXTRACT(MONTH FROM taken_at)::int AS month,
                EXTRACT(DAY FROM taken_at)::int AS day,
                COUNT(*) AS count
            FROM photos
            WHERE app_id = $1
              AND taken_at IS NOT NULL
              AND is_hidden = false
              AND deleted_at IS NULL
            GROUP BY year, month, day
            ORDER BY year DESC, month DESC, day DESC
            ",
            [app_id.into()],
        );
        let results = db.query_all_raw(stmt).await.map_err(AppError::Database)?;
        let mut entries = Vec::new();
        for row in results {
            let year: i32 = row.try_get("", "year").unwrap_or(0);
            let month: i32 = row.try_get("", "month").unwrap_or(0);
            let day: i32 = row.try_get("", "day").unwrap_or(0);
            let count: i64 = row.try_get("", "count").unwrap_or(0);
            entries.push(TimelineEntry {
                year,
                month,
                day,
                count,
            });
        }
        Ok(entries)
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
            .filter(photos::Column::DeletedAt.is_null())
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

    /// List photos filtered by geo location fields.
    pub async fn list_by_location(
        db: &DatabaseConnection,
        app_id: Uuid,
        page: &PageInput,
        province: Option<&str>,
        city: Option<&str>,
        district: Option<&str>,
    ) -> Result<Page<PhotoOutput>, AppError> {
        let mut query = photos::Entity::find()
            .filter(photos::Column::AppId.eq(app_id))
            .filter(photos::Column::DeletedAt.is_null())
            .filter(photos::Column::IsHidden.eq(false));

        if let Some(prov) = province {
            query = query.filter(photos::Column::GeoProvince.eq(prov));
        }
        if let Some(c) = city {
            query = query.filter(photos::Column::GeoCity.eq(c));
        }
        if let Some(d) = district {
            query = query.filter(photos::Column::GeoDistrict.eq(d));
        }

        let query = query
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

    /// Return all photos with GPS coordinates for map display.
    pub async fn list_map_points(db: &DatabaseConnection, app_id: Uuid) -> Result<Vec<PhotoMapPoint>, AppError> {
        let items = photos::Entity::find()
            .filter(photos::Column::AppId.eq(app_id))
            .filter(photos::Column::DeletedAt.is_null())
            .filter(photos::Column::IsHidden.eq(false))
            .filter(photos::Column::GpsLatitude.is_not_null())
            .filter(photos::Column::GpsLongitude.is_not_null())
            .into_partial_model::<PhotoMapPoint>()
            .all(db)
            .await?;

        Ok(items)
    }

    /// Return photos within a geographic bounding box, paginated.
    pub async fn list_by_bbox(
        db: &DatabaseConnection,
        app_id: Uuid,
        min_lat: f64,
        max_lat: f64,
        min_lng: f64,
        max_lng: f64,
        page: &PageInput,
    ) -> Result<Page<PhotoOutput>, AppError> {
        let query = photos::Entity::find()
            .filter(photos::Column::AppId.eq(app_id))
            .filter(photos::Column::DeletedAt.is_null())
            .filter(photos::Column::IsHidden.eq(false))
            .filter(photos::Column::GpsLatitude.is_not_null())
            .filter(photos::Column::GpsLongitude.is_not_null())
            .filter(photos::Column::GpsLatitude.gte(min_lat))
            .filter(photos::Column::GpsLatitude.lte(max_lat))
            .filter(photos::Column::GpsLongitude.gte(min_lng))
            .filter(photos::Column::GpsLongitude.lte(max_lng))
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

    /// Get the raw `photos::Model` by ID (for internal use; does not convert to DTO).
    pub async fn get_model_by_id(db: &DatabaseConnection, photo_id: Uuid) -> Result<Option<photos::Model>, AppError> {
        Ok(photos::Entity::find_by_id(photo_id).one(db).await?)
    }

    /// Fetch multiple `vfs` rows by ID and return them as a `HashMap` keyed by UUID.
    pub async fn get_file_systems_by_ids(
        db: &DatabaseConnection,
        ids: Vec<Uuid>,
    ) -> Result<std::collections::HashMap<Uuid, vfs::Model>, AppError> {
        let rows = vfs::Entity::find().filter(vfs::Column::Id.is_in(ids)).all(db).await?;
        Ok(rows.into_iter().map(|fs| (fs.id, fs)).collect())
    }

    /// Get a single `vfs` row by ID.
    pub async fn get_file_system_by_id(db: &DatabaseConnection, id: Uuid) -> Result<Option<vfs::Model>, AppError> {
        Ok(vfs::Entity::find_by_id(id).one(db).await?)
    }

    /// Set `live_video_path` on a photo.
    pub async fn update_live_video_path(db: &DatabaseConnection, photo_id: Uuid, path: String) -> Result<(), AppError> {
        let active = photos::ActiveModel {
            id: Set(photo_id),
            live_video_path: Set(Some(path)),
            ..Default::default()
        };
        active.update(db).await?;
        Ok(())
    }

    /// Return all non-deleted photo IDs belonging to an app.
    pub async fn get_ids_for_app(db: &DatabaseConnection, app_id: Uuid) -> Result<Vec<Uuid>, AppError> {
        use sea_orm::DerivePartialModel;

        #[derive(DerivePartialModel)]
        #[sea_orm(entity = "photos::Entity")]
        struct PhotoId {
            pub id: Uuid,
        }

        let rows = photos::Entity::find()
            .filter(photos::Column::AppId.eq(app_id))
            .filter(photos::Column::DeletedAt.is_null())
            .into_partial_model::<PhotoId>()
            .all(db)
            .await?;
        Ok(rows.into_iter().map(|r| r.id).collect())
    }

    /// Delete OCR results for an app's photos and reset their `ocr_scanned_at`.
    /// When `model_name` is Some, only results from that model are removed.
    /// Returns the number of deleted OCR result rows.
    pub async fn clear_ocr_results_for_app(
        db: &DatabaseConnection,
        app_id: Uuid,
        model_name: Option<&str>,
    ) -> Result<u64, AppError> {
        use crate::db::entities::photo_ocr_results;

        let photo_ids = Self::get_ids_for_app(db, app_id).await?;
        if photo_ids.is_empty() {
            return Ok(0);
        }

        let mut delete_q =
            photo_ocr_results::Entity::delete_many().filter(photo_ocr_results::Column::PhotoId.is_in(photo_ids));
        if let Some(m) = model_name {
            delete_q = delete_q.filter(photo_ocr_results::Column::ModelName.eq(m));
        }
        let deleted = delete_q.exec(db).await?.rows_affected;

        let mut update_q = photos::Entity::update_many()
            .col_expr(photos::Column::OcrScannedAt, Expr::cust("NULL"))
            .filter(photos::Column::AppId.eq(app_id))
            .filter(photos::Column::DeletedAt.is_null());
        if model_name.is_some() {
            update_q = update_q.filter(photos::Column::OcrScannedAt.is_not_null());
        }
        update_q.exec(db).await?;

        Ok(deleted)
    }

    /// Delete ALL OCR results across every app and reset `ocr_scanned_at` on affected photos.
    pub async fn clear_all_ocr_results(db: &DatabaseConnection) -> Result<u64, AppError> {
        use crate::db::entities::photo_ocr_results;

        let deleted = photo_ocr_results::Entity::delete_many().exec(db).await?.rows_affected;

        photos::Entity::update_many()
            .col_expr(photos::Column::OcrScannedAt, Expr::cust("NULL"))
            .filter(photos::Column::OcrScannedAt.is_not_null())
            .filter(photos::Column::DeletedAt.is_null())
            .exec(db)
            .await?;

        Ok(deleted)
    }

    /// Delete face-detection results for an app's photos and reset related persons.
    /// Returns the number of deleted `photo_faces` rows.
    pub async fn clear_face_results_for_app(db: &DatabaseConnection, app_id: Uuid) -> Result<u64, AppError> {
        use crate::db::entities::{photo_faces, photo_persons};

        let photo_ids = Self::get_ids_for_app(db, app_id).await?;
        if photo_ids.is_empty() {
            return Ok(0);
        }

        let deleted = photo_faces::Entity::delete_many()
            .filter(photo_faces::Column::PhotoId.is_in(photo_ids))
            .exec(db)
            .await?
            .rows_affected;

        photo_persons::Entity::update_many()
            .col_expr(photo_persons::Column::FaceCount, Expr::val(0i32))
            .col_expr(photo_persons::Column::AvatarFaceId, Expr::cust("NULL"))
            .filter(photo_persons::Column::AppId.eq(app_id))
            .exec(db)
            .await?;

        Ok(deleted)
    }

    /// Delete CLIP embedding vectors for an app's photos.
    /// Returns the number of deleted rows.
    pub async fn clear_clip_results_for_app(db: &DatabaseConnection, app_id: Uuid) -> Result<u64, AppError> {
        use crate::db::entities::photo_clip_vectors;

        let photo_ids = Self::get_ids_for_app(db, app_id).await?;
        if photo_ids.is_empty() {
            return Ok(0);
        }

        let deleted = photo_clip_vectors::Entity::delete_many()
            .filter(photo_clip_vectors::Column::PhotoId.is_in(photo_ids))
            .exec(db)
            .await?
            .rows_affected;

        Ok(deleted)
    }

    /// Fetch stored OCR results for a single photo.
    pub async fn get_ocr_results(
        db: &DatabaseConnection,
        photo_id: Uuid,
    ) -> Result<Vec<crate::db::entities::photo_ocr_results::Model>, AppError> {
        use crate::db::entities::photo_ocr_results;
        Ok(photo_ocr_results::Entity::find()
            .filter(photo_ocr_results::Column::PhotoId.eq(photo_id))
            .all(db)
            .await?)
    }
}
