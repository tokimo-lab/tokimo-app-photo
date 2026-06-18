use sea_orm::*;
use uuid::Uuid;

use crate::db::entities::books;
use crate::error::AppError;

pub struct BookRepo;

impl BookRepo {
    pub async fn get_container_by_id(db: &impl ConnectionTrait, id: Uuid) -> Result<Option<books::Model>, AppError> {
        Ok(books::Entity::find_by_id(id).one(db).await?)
    }

    pub async fn update_sync_status(
        db: &impl ConnectionTrait,
        id: Uuid,
        status: &str,
        last_sync_at: Option<chrono::DateTime<chrono::Utc>>,
    ) -> Result<(), AppError> {
        let now = last_sync_at.map(|t| t.fixed_offset());
        let mut model = books::ActiveModel {
            id: Set(id),
            sync_status: Set(status.to_string()),
            ..Default::default()
        };
        if let Some(t) = now {
            model.last_sync_at = Set(Some(t));
        }
        books::Entity::update(model).exec(db).await?;
        Ok(())
    }

    pub fn parse_sources(sources: &serde_json::Value) -> Vec<(Uuid, String, bool)> {
        sources
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| {
                        let id = v.get("sourceId").and_then(|s| s.as_str())?;
                        let path = v.get("rootPath").and_then(|s| s.as_str())?;
                        let is_default = v.get("isDefaultDownload").and_then(|b| b.as_bool()).unwrap_or(false);
                        Some((Uuid::parse_str(id).ok()?, path.to_string(), is_default))
                    })
                    .collect()
            })
            .unwrap_or_default()
    }
}
