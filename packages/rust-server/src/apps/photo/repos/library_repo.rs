use chrono::Utc;
use sea_orm::prelude::DateTimeWithTimeZone;
use sea_orm::sea_query::Expr;
use sea_orm::*;
use uuid::Uuid;

use crate::db::entities::photo_libraries;
use crate::error::AppError;
use crate::error::OptionExt;

#[derive(Debug)]
pub struct UpdatePhotoLibraryFields {
    pub name: Option<String>,
    pub description: Option<String>,
    pub avatar: Option<serde_json::Value>,
    pub poster_path: Option<String>,
    pub scrape_enabled: Option<bool>,
    pub scrape_agents: Option<Vec<String>>,
    pub settings: Option<serde_json::Value>,
    pub sources: Option<serde_json::Value>,
}

pub struct PhotoLibraryRepo;

impl PhotoLibraryRepo {
    pub async fn list_all(db: &DatabaseConnection) -> Result<Vec<photo_libraries::Model>, AppError> {
        let rows = photo_libraries::Entity::find()
            .order_by_asc(photo_libraries::Column::SortOrder)
            .order_by_asc(photo_libraries::Column::CreatedAt)
            .all(db)
            .await?;
        Ok(rows)
    }

    pub async fn get_by_id(db: &DatabaseConnection, id: Uuid) -> Result<Option<photo_libraries::Model>, AppError> {
        Ok(photo_libraries::Entity::find_by_id(id).one(db).await?)
    }

    pub async fn create(
        db: &DatabaseConnection,
        name: String,
        photo_type: String,
        settings: Option<serde_json::Value>,
    ) -> Result<photo_libraries::Model, AppError> {
        let id = Uuid::new_v4();
        let now = chrono::Utc::now().fixed_offset();
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
        db: &DatabaseConnection,
        id: Uuid,
        input: UpdatePhotoLibraryFields,
    ) -> Result<photo_libraries::Model, AppError> {
        let model = photo_libraries::Entity::find_by_id(id)
            .one(db)
            .await?
            .not_found(format!("photo library {id} not found"))?;
        let mut active: photo_libraries::ActiveModel = model.into();
        if let Some(name) = input.name {
            active.name = Set(name);
        }
        if let Some(description) = input.description {
            active.description = Set(Some(description));
        }
        if let Some(avatar) = input.avatar {
            active.avatar = Set(Some(avatar));
        }
        if let Some(poster_path) = input.poster_path {
            active.poster_path = Set(Some(poster_path));
        }
        if let Some(scrape_enabled) = input.scrape_enabled {
            active.scrape_enabled = Set(scrape_enabled);
        }
        if let Some(scrape_agents) = input.scrape_agents {
            active.scrape_agents = Set(scrape_agents);
        }
        if let Some(settings) = input.settings {
            active.settings = Set(Some(settings));
        }
        if let Some(sources) = input.sources {
            active.sources = Set(sources);
        }
        active.updated_at = Set(Some(chrono::Utc::now().fixed_offset()));
        let updated = active.update(db).await?;
        Ok(updated)
    }

    pub async fn delete(db: &DatabaseConnection, id: Uuid) -> Result<u64, AppError> {
        let result = photo_libraries::Entity::delete_by_id(id).exec(db).await?;
        Ok(result.rows_affected)
    }

    pub async fn reorder(db: &DatabaseConnection, orders: Vec<(Uuid, i32)>) -> Result<(), AppError> {
        for (id, sort_order) in orders {
            photo_libraries::Entity::update_many()
                .filter(photo_libraries::Column::Id.eq(id))
                .col_expr(photo_libraries::Column::SortOrder, Expr::value(sort_order))
                .exec(db)
                .await?;
        }
        Ok(())
    }

    pub async fn update_sync_status(
        db: &DatabaseConnection,
        id: Uuid,
        status: &str,
        last_sync_at: Option<DateTimeWithTimeZone>,
    ) -> Result<(), AppError> {
        let model = photo_libraries::Entity::find_by_id(id)
            .one(db)
            .await?
            .not_found(format!("photo library {id} not found"))?;
        let mut active: photo_libraries::ActiveModel = model.into();
        active.sync_status = Set(status.to_string());
        if let Some(ts) = last_sync_at {
            active.last_sync_at = Set(Some(ts));
        }
        active.updated_at = Set(Some(Utc::now().fixed_offset()));
        active.update(db).await?;
        Ok(())
    }

    pub async fn get_sync_status(
        db: &DatabaseConnection,
        id: Uuid,
    ) -> Result<Option<(String, Option<DateTimeWithTimeZone>)>, AppError> {
        Ok(photo_libraries::Entity::find_by_id(id)
            .one(db)
            .await?
            .map(|m| (m.sync_status, m.last_sync_at)))
    }

    /// Parse sources JSON. Returns `(source_id, root_path, is_default_download)` tuples.
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
