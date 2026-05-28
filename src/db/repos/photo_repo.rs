use chrono::NaiveDate;
use sea_orm::sea_query::Expr;
use sea_orm::*;
use uuid::Uuid;

use crate::db::entities::{photo_albums, photo_clip_vectors, photo_faces, photo_ocr_results, photo_persons, photos};
use crate::db::pagination::{Page, PageInput};
use crate::error::{AppError, OptionExt};
use crate::models::{
    FolderInfo, PhotoAlbumOutput, PhotoDetailOutput, PhotoOutput, PhotoStreamTarget,
};

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

#[derive(Debug, serde::Serialize)]
pub struct LocationGroup {
    pub province: Option<String>,
    pub city: Option<String>,
    pub district: Option<String>,
    pub count: i64,
}

pub struct PhotoRepo;

#[allow(dead_code)]
impl PhotoRepo {
    pub async fn list(
        db: &DatabaseConnection,
        input: ListPhotosInput,
    ) -> Result<Page<PhotoOutput>, AppError> {
        let mut query = photos::Entity::find()
            .filter(photos::Column::AppId.eq(input.app_id))
            .filter(photos::Column::IsHidden.eq(false))
            .filter(photos::Column::DeletedAt.is_null());

        if input.favorites_only {
            query = query.filter(photos::Column::IsFavorite.eq(true));
        }

        if let Some(date_str) = input.before_date
            && let Ok(dt) = NaiveDate::parse_from_str(&date_str, "%Y-%m-%d")
        {
            let end_of_day = dt.and_hms_opt(23, 59, 59).unwrap().and_utc().fixed_offset();
            query = query.filter(photos::Column::TakenAt.lte(end_of_day));
        }

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

    pub async fn get_by_id(
        db: &DatabaseConnection,
        photo_id: Uuid,
    ) -> Result<Option<PhotoDetailOutput>, AppError> {
        Ok(photos::Entity::find_by_id(photo_id)
            .one(db)
            .await?
            .map(PhotoDetailOutput::from))
    }

    pub async fn get_model_by_id(
        db: &DatabaseConnection,
        photo_id: Uuid,
    ) -> Result<Option<photos::Model>, AppError> {
        Ok(photos::Entity::find_by_id(photo_id).one(db).await?)
    }

    pub async fn toggle_favorite(
        db: &DatabaseConnection,
        photo_id: Uuid,
    ) -> Result<bool, AppError> {
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

    pub async fn list_albums(
        db: &DatabaseConnection,
        app_id: Uuid,
    ) -> Result<Vec<PhotoAlbumOutput>, AppError> {
        Ok(photo_albums::Entity::find()
            .filter(photo_albums::Column::AppId.eq(app_id))
            .order_by_asc(photo_albums::Column::SortOrder)
            .into_partial_model::<PhotoAlbumOutput>()
            .all(db)
            .await?)
    }

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

    pub async fn load_stream_target(
        db: &DatabaseConnection,
        photo_id: Uuid,
    ) -> Result<Option<PhotoStreamTarget>, AppError> {
        let row = photos::Entity::find_by_id(photo_id).one(db).await?;
        Ok(row.map(|photo| PhotoStreamTarget {
            path: photo.path,
            mime_type: photo.mime_type,
            thumbnail_path: photo.thumbnail_path,
            live_video_path: photo.live_video_path,
            source_id: photo.source_id,
        }))
    }

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

    pub async fn count(db: &DatabaseConnection, app_id: Uuid) -> Result<u64, AppError> {
        Ok(photos::Entity::find()
            .filter(photos::Column::AppId.eq(app_id))
            .count(db)
            .await?)
    }

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

    pub async fn delete_album(db: &DatabaseConnection, album_id: Uuid) -> Result<(), AppError> {
        photos::Entity::update_many()
            .filter(photos::Column::PhotoAlbumId.eq(album_id))
            .col_expr(
                photos::Column::PhotoAlbumId,
                Expr::value(Option::<Uuid>::None),
            )
            .exec(db)
            .await?;
        photo_albums::Entity::delete_by_id(album_id).exec(db).await?;
        Ok(())
    }

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
            .col_expr(
                photos::Column::PhotoAlbumId,
                Expr::value(Some(album_id)),
            )
            .exec(db)
            .await?;

        let count =
            photos::Entity::find().filter(photos::Column::PhotoAlbumId.eq(album_id)).count(db).await? as i32;

        let mut album_active: photo_albums::ActiveModel = photo_albums::Entity::find_by_id(album_id)
            .one(db)
            .await?
            .not_found("Album not found")?
            .into();
        album_active.photo_count = Set(count);
        if album_active.cover_photo_id == NotSet && !photo_ids.is_empty() {
            album_active.cover_photo_id = Set(Some(photo_ids[0]));
        }
        album_active.update(db).await?;

        Ok(count)
    }

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

        let count =
            photos::Entity::find().filter(photos::Column::PhotoAlbumId.eq(album_id)).count(db).await? as i32;

        let mut album_active: photo_albums::ActiveModel = photo_albums::Entity::find_by_id(album_id)
            .one(db)
            .await?
            .not_found("Album not found")?
            .into();
        album_active.photo_count = Set(count);
        album_active.update(db).await?;

        Ok(count)
    }

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

    pub async fn batch_set_favorite(
        db: &DatabaseConnection,
        photo_ids: &[Uuid],
        favorite: bool,
    ) -> Result<u64, AppError> {
        Ok(photos::Entity::update_many()
            .filter(photos::Column::Id.is_in(photo_ids.to_vec()))
            .col_expr(photos::Column::IsFavorite, Expr::value(favorite))
            .exec(db)
            .await?
            .rows_affected)
    }

    pub async fn batch_delete(
        db: &DatabaseConnection,
        app_id: Uuid,
        photo_ids: &[Uuid],
    ) -> Result<u64, AppError> {
        Ok(photos::Entity::delete_many()
            .filter(photos::Column::AppId.eq(app_id))
            .filter(photos::Column::Id.is_in(photo_ids.to_vec()))
            .exec(db)
            .await?
            .rows_affected)
    }

    pub async fn batch_set_hidden(
        db: &DatabaseConnection,
        photo_ids: &[Uuid],
        hidden: bool,
    ) -> Result<u64, AppError> {
        Ok(photos::Entity::update_many()
            .filter(photos::Column::Id.is_in(photo_ids.to_vec()))
            .col_expr(photos::Column::IsHidden, Expr::value(hidden))
            .exec(db)
            .await?
            .rows_affected)
    }

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
        Ok(PhotoDetailOutput::from(active.update(db).await?))
    }

    pub async fn trash_photos(
        db: &DatabaseConnection,
        app_id: Uuid,
        photo_ids: &[Uuid],
    ) -> Result<u64, AppError> {
        let now = chrono::Utc::now().fixed_offset();
        Ok(photos::Entity::update_many()
            .filter(photos::Column::AppId.eq(app_id))
            .filter(photos::Column::Id.is_in(photo_ids.to_vec()))
            .filter(photos::Column::DeletedAt.is_null())
            .col_expr(photos::Column::DeletedAt, Expr::value(now))
            .exec(db)
            .await?
            .rows_affected)
    }

    pub async fn restore_photos(
        db: &DatabaseConnection,
        app_id: Uuid,
        photo_ids: &[Uuid],
    ) -> Result<u64, AppError> {
        Ok(photos::Entity::update_many()
            .filter(photos::Column::AppId.eq(app_id))
            .filter(photos::Column::Id.is_in(photo_ids.to_vec()))
            .filter(photos::Column::DeletedAt.is_not_null())
            .col_expr(
                photos::Column::DeletedAt,
                Expr::value(Option::<chrono::DateTime<chrono::FixedOffset>>::None),
            )
            .exec(db)
            .await?
            .rows_affected)
    }

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

    pub async fn permanent_delete(
        db: &DatabaseConnection,
        app_id: Uuid,
        photo_ids: &[Uuid],
    ) -> Result<u64, AppError> {
        Ok(photos::Entity::delete_many()
            .filter(photos::Column::AppId.eq(app_id))
            .filter(photos::Column::Id.is_in(photo_ids.to_vec()))
            .filter(photos::Column::DeletedAt.is_not_null())
            .exec(db)
            .await?
            .rows_affected)
    }

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

    pub async fn list_map_points(
        db: &DatabaseConnection,
        app_id: Uuid,
    ) -> Result<Vec<PhotoMapPoint>, AppError> {
        Ok(photos::Entity::find()
            .filter(photos::Column::AppId.eq(app_id))
            .filter(photos::Column::DeletedAt.is_null())
            .filter(photos::Column::IsHidden.eq(false))
            .filter(photos::Column::GpsLatitude.is_not_null())
            .filter(photos::Column::GpsLongitude.is_not_null())
            .into_partial_model::<PhotoMapPoint>()
            .all(db)
            .await?)
    }

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

    pub async fn timeline_index(
        db: &DatabaseConnection,
        app_id: Uuid,
    ) -> Result<Vec<TimelineEntry>, AppError> {
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
            entries.push(TimelineEntry { year, month, day, count });
        }
        Ok(entries)
    }

    pub async fn get_ids_for_app(
        db: &DatabaseConnection,
        app_id: Uuid,
    ) -> Result<Vec<Uuid>, AppError> {
        #[derive(DerivePartialModel)]
        #[sea_orm(entity = "photos::Entity")]
        struct PhotoId {
            pub id: Uuid,
        }

        Ok(photos::Entity::find()
            .filter(photos::Column::AppId.eq(app_id))
            .filter(photos::Column::DeletedAt.is_null())
            .into_partial_model::<PhotoId>()
            .all(db)
            .await?
            .into_iter()
            .map(|r| r.id)
            .collect())
    }

    pub async fn clear_ocr_results_for_app(
        db: &DatabaseConnection,
        app_id: Uuid,
        model_name: Option<&str>,
    ) -> Result<u64, AppError> {
        let photo_ids = Self::get_ids_for_app(db, app_id).await?;
        if photo_ids.is_empty() {
            return Ok(0);
        }

        let mut delete_q = photo_ocr_results::Entity::delete_many()
            .filter(photo_ocr_results::Column::PhotoId.is_in(photo_ids));
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

    pub async fn clear_all_ocr_results(db: &DatabaseConnection) -> Result<u64, AppError> {
        let deleted = photo_ocr_results::Entity::delete_many().exec(db).await?.rows_affected;
        photos::Entity::update_many()
            .col_expr(photos::Column::OcrScannedAt, Expr::cust("NULL"))
            .filter(photos::Column::OcrScannedAt.is_not_null())
            .filter(photos::Column::DeletedAt.is_null())
            .exec(db)
            .await?;
        Ok(deleted)
    }

    pub async fn clear_face_results_for_app(
        db: &DatabaseConnection,
        app_id: Uuid,
    ) -> Result<u64, AppError> {
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

    pub async fn clear_clip_results_for_app(
        db: &DatabaseConnection,
        app_id: Uuid,
    ) -> Result<u64, AppError> {
        let photo_ids = Self::get_ids_for_app(db, app_id).await?;
        if photo_ids.is_empty() {
            return Ok(0);
        }

        Ok(photo_clip_vectors::Entity::delete_many()
            .filter(photo_clip_vectors::Column::PhotoId.is_in(photo_ids))
            .exec(db)
            .await?
            .rows_affected)
    }

    pub async fn get_ocr_results(
        db: &DatabaseConnection,
        photo_id: Uuid,
    ) -> Result<Vec<photo_ocr_results::Model>, AppError> {
        Ok(photo_ocr_results::Entity::find()
            .filter(photo_ocr_results::Column::PhotoId.eq(photo_id))
            .all(db)
            .await?)
    }

    pub async fn delete_ocr_result(db: &DatabaseConnection, ocr_id: i32) -> Result<(), AppError> {
        photo_ocr_results::Entity::delete_by_id(ocr_id)
            .exec(db)
            .await?;
        Ok(())
    }

    // ── Face / Person ──────────────────────────────────────────────────────────

    pub async fn get_faces_for_photo(
        db: &DatabaseConnection,
        photo_id: Uuid,
    ) -> Result<Vec<photo_faces::Model>, AppError> {
        Ok(photo_faces::Entity::find()
            .filter(photo_faces::Column::PhotoId.eq(photo_id))
            .all(db)
            .await?)
    }

    pub async fn assign_face_to_person(
        db: &DatabaseConnection,
        face_id: i32,
        person_id: Uuid,
    ) -> Result<(), AppError> {
        let face = photo_faces::Entity::find_by_id(face_id)
            .one(db)
            .await?
            .not_found(format!("face {face_id} not found"))?;
        let mut active: photo_faces::ActiveModel = face.into();
        active.person_id = Set(Some(person_id));
        active.update(db).await?;
        Ok(())
    }

    pub async fn create_person_from_face(
        db: &DatabaseConnection,
        face_id: i32,
        name: &str,
    ) -> Result<photo_persons::Model, AppError> {
        let face = photo_faces::Entity::find_by_id(face_id)
            .one(db)
            .await?
            .not_found(format!("face {face_id} not found"))?;

        // Find what app_id this photo belongs to
        let photo = photos::Entity::find_by_id(face.photo_id)
            .one(db)
            .await?
            .not_found("photo for face not found")?;

        let person_id = Uuid::new_v4();
        let now = chrono::Utc::now().fixed_offset();

        let person = photo_persons::ActiveModel {
            id: Set(person_id),
            app_id: Set(photo.app_id),
            name: Set(Some(name.to_string())),
            avatar_face_id: Set(Some(face_id)),
            face_count: Set(1),
            is_hidden: Set(false),
            created_at: Set(now),
            updated_at: Set(now),
        };
        photo_persons::Entity::insert(person).exec(db).await?;

        // Assign face to the new person
        let mut active: photo_faces::ActiveModel = face.into();
        active.person_id = Set(Some(person_id));
        active.update(db).await?;

        photo_persons::Entity::find_by_id(person_id)
            .one(db)
            .await?
            .internal("failed to fetch created person")
    }

    pub async fn list_persons(
        db: &DatabaseConnection,
        app_id: Uuid,
    ) -> Result<Vec<photo_persons::Model>, AppError> {
        Ok(photo_persons::Entity::find()
            .filter(photo_persons::Column::AppId.eq(app_id))
            .filter(photo_persons::Column::IsHidden.eq(false))
            .order_by_desc(photo_persons::Column::FaceCount)
            .all(db)
            .await?)
    }

    pub async fn list_photos_by_person(
        db: &DatabaseConnection,
        person_id: Uuid,
        page: &PageInput,
    ) -> Result<Page<PhotoOutput>, AppError> {
        let face_photo_ids: Vec<Uuid> = photo_faces::Entity::find()
            .filter(photo_faces::Column::PersonId.eq(person_id))
            .select_only()
            .column(photo_faces::Column::PhotoId)
            .into_tuple::<Uuid>()
            .all(db)
            .await?;

        if face_photo_ids.is_empty() {
            return Ok(Page::new(vec![], 0, page));
        }

        let total = face_photo_ids.len() as i64;
        let items = photos::Entity::find()
            .filter(photos::Column::Id.is_in(face_photo_ids))
            .filter(photos::Column::DeletedAt.is_null())
            .into_partial_model::<PhotoOutput>()
            .paginate(db, page.page_size)
            .fetch_page(page.page.saturating_sub(1))
            .await?;

        Ok(Page::new(items, total, page))
    }

    pub async fn merge_persons(
        db: &DatabaseConnection,
        target_id: Uuid,
        source_id: Uuid,
    ) -> Result<(), AppError> {
        // Reassign all faces from source to target
        photo_faces::Entity::update_many()
            .col_expr(photo_faces::Column::PersonId, Expr::value(target_id))
            .filter(photo_faces::Column::PersonId.eq(source_id))
            .exec(db)
            .await?;

        // Update target face count
        let count = photo_faces::Entity::find()
            .filter(photo_faces::Column::PersonId.eq(target_id))
            .count(db)
            .await? as i32;
        photo_persons::Entity::update_many()
            .col_expr(photo_persons::Column::FaceCount, Expr::value(count))
            .filter(photo_persons::Column::Id.eq(target_id))
            .exec(db)
            .await?;

        // Delete source person
        photo_persons::Entity::delete_by_id(source_id).exec(db).await?;
        Ok(())
    }

    pub async fn rename_person(
        db: &DatabaseConnection,
        person_id: Uuid,
        name: &str,
    ) -> Result<(), AppError> {
        photo_persons::Entity::update_many()
            .col_expr(photo_persons::Column::Name, Expr::value(name.to_string()))
            .filter(photo_persons::Column::Id.eq(person_id))
            .exec(db)
            .await?;
        Ok(())
    }

    // ── Location stats ─────────────────────────────────────────────────────────

    pub async fn location_stats(
        db: &DatabaseConnection,
        app_id: Uuid,
    ) -> Result<Vec<LocationGroup>, AppError> {
        use sea_orm::{ConnectionTrait, DatabaseBackend, Statement};

        let rows = db
            .query_all_raw(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r"SELECT geo_province, geo_city, geo_district, COUNT(*) as count
                  FROM photos
                  WHERE app_id = $1
                    AND deleted_at IS NULL
                    AND (geo_province IS NOT NULL OR geo_city IS NOT NULL)
                  GROUP BY geo_province, geo_city, geo_district
                  ORDER BY count DESC
                  LIMIT 200",
                [app_id.into()],
            ))
            .await?;

        let mut result = Vec::with_capacity(rows.len());
        for row in rows {
            result.push(LocationGroup {
                province: row.try_get("", "geo_province").ok(),
                city: row.try_get("", "geo_city").ok(),
                district: row.try_get("", "geo_district").ok(),
                count: row.try_get("", "count").unwrap_or(0),
            });
        }
        Ok(result)
    }
}
