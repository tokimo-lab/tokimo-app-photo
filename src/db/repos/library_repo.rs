use chrono::Utc;
use sea_orm::prelude::DateTimeWithTimeZone;
use sea_orm::sea_query::Expr;
use sea_orm::*;
use uuid::Uuid;

use crate::db::entities::photo_libraries;
use crate::error::{AppError, OptionExt};

#[derive(Debug)]
pub struct UpdatePhotoLibraryFields {
    pub name: Option<String>,
    pub description: Option<String>,
    pub avatar: Option<serde_json::Value>,
    pub poster_path: Option<String>,
    pub scrape_enabled: Option<bool>,
    pub settings: Option<serde_json::Value>,
    pub sources: Option<serde_json::Value>,
}

pub struct PhotoLibraryRepo;

impl PhotoLibraryRepo {
    pub async fn list_all(db: &impl ConnectionTrait) -> Result<Vec<photo_libraries::Model>, AppError> {
        Ok(photo_libraries::Entity::find()
            .order_by_asc(photo_libraries::Column::SortOrder)
            .order_by_asc(photo_libraries::Column::CreatedAt)
            .all(db)
            .await?)
    }

    pub async fn get_by_id(
        db: &impl ConnectionTrait,
        id: Uuid,
    ) -> Result<Option<photo_libraries::Model>, AppError> {
        Ok(photo_libraries::Entity::find_by_id(id).one(db).await?)
    }

    pub async fn create(
        db: &impl ConnectionTrait,
        name: String,
        photo_type: String,
        settings: Option<serde_json::Value>,
    ) -> Result<photo_libraries::Model, AppError> {
        let id = Uuid::new_v4();
        let now = Utc::now().fixed_offset();
        let max_sort = photo_libraries::Entity::find()
            .order_by_desc(photo_libraries::Column::SortOrder)
            .one(db)
            .await?
            .map_or(0, |m| m.sort_order);

        let active = photo_libraries::ActiveModel {
            id: Set(id),
            name: Set(name),
            r#type: Set(photo_type),
            sort_order: Set(max_sort + 1),
            settings: Set(settings),
            sources: Set(serde_json::json!([])),
            scrape_enabled: Set(false),
            sync_status: Set("idle".to_string()),
            created_at: Set(Some(now)),
            updated_at: Set(Some(now)),
            ..Default::default()
        };
        photo_libraries::Entity::insert(active).exec(db).await?;
        photo_libraries::Entity::find_by_id(id)
            .one(db)
            .await?
            .internal("failed to fetch created photo library")
    }

    pub async fn update(
        db: &impl ConnectionTrait,
        id: Uuid,
        input: UpdatePhotoLibraryFields,
    ) -> Result<photo_libraries::Model, AppError> {
        let mut update = photo_libraries::Entity::update_many()
            .filter(photo_libraries::Column::Id.eq(id));
        if let Some(name) = input.name {
            update = update.col_expr(photo_libraries::Column::Name, Expr::value(name));
        }
        if let Some(description) = input.description {
            update = update.col_expr(photo_libraries::Column::Description, Expr::value(Some(description)));
        }
        if let Some(avatar) = input.avatar {
            update = update.col_expr(photo_libraries::Column::Avatar, Expr::value(Some(avatar)));
        }
        if let Some(poster_path) = input.poster_path {
            update = update.col_expr(photo_libraries::Column::PosterPath, Expr::value(Some(poster_path)));
        }
        if let Some(scrape_enabled) = input.scrape_enabled {
            update = update.col_expr(photo_libraries::Column::ScrapeEnabled, Expr::value(scrape_enabled));
        }
        if let Some(settings) = input.settings {
            update = update.col_expr(photo_libraries::Column::Settings, Expr::value(Some(settings)));
        }
        if let Some(sources) = input.sources {
            update = update.col_expr(photo_libraries::Column::Sources, Expr::value(sources));
        }
        update = update.col_expr(photo_libraries::Column::UpdatedAt, Expr::value(Some(Utc::now().fixed_offset())));
        let results = update.exec_with_returning(db).await?;
        results
            .into_iter()
            .next()
            .not_found(format!("photo library {id} not found"))
    }

    pub async fn delete(db: &impl ConnectionTrait, id: Uuid) -> Result<u64, AppError> {
        Ok(photo_libraries::Entity::delete_by_id(id)
            .exec(db)
            .await?
            .rows_affected)
    }

    pub async fn reorder(
        db: &DatabaseConnection,
        orders: Vec<(Uuid, i32)>,
    ) -> Result<(), AppError> {
        let txn = db.begin().await?;
        for (id, sort_order) in orders {
            photo_libraries::Entity::update_many()
                .filter(photo_libraries::Column::Id.eq(id))
                .col_expr(photo_libraries::Column::SortOrder, Expr::value(sort_order))
                .exec(&txn)
                .await?;
        }
        txn.commit().await?;
        Ok(())
    }

    pub async fn update_sync_status(
        db: &impl ConnectionTrait,
        id: Uuid,
        status: &str,
        last_sync_at: Option<DateTimeWithTimeZone>,
    ) -> Result<(), AppError> {
        let mut update = photo_libraries::Entity::update_many()
            .filter(photo_libraries::Column::Id.eq(id))
            .col_expr(photo_libraries::Column::SyncStatus, Expr::value(status.to_string()))
            .col_expr(photo_libraries::Column::UpdatedAt, Expr::value(Some(Utc::now().fixed_offset())));
        if let Some(ts) = last_sync_at {
            update = update.col_expr(photo_libraries::Column::LastSyncAt, Expr::value(Some(ts)));
        }
        let result = update.exec(db).await?;
        if result.rows_affected == 0 {
            return Err(AppError::NotFound(format!("photo library {id} not found")));
        }
        Ok(())
    }

    /// Parse sources JSON from a library model.
    /// Returns `(source_id, root_path, is_default_download)` tuples.
    pub fn parse_sources(sources_json: &serde_json::Value) -> Vec<(Uuid, String, bool)> {
        sources_json
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|item| {
                        let source_id = item
                            .get("sourceId")
                            .and_then(|v| v.as_str())
                            .and_then(|s| s.parse::<Uuid>().ok())?;
                        let root_path = item
                            .get("rootPath")
                            .and_then(|v| v.as_str())
                            .map(std::string::ToString::to_string)?;
                        let is_default = item
                            .get("isDefaultDownload")
                            .and_then(serde_json::Value::as_bool)
                            .unwrap_or(false);
                        Some((source_id, root_path, is_default))
                    })
                    .collect()
            })
            .unwrap_or_default()
    }
}
