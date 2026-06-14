use sea_orm::*;

use crate::db::entities::vfs;
use crate::db::models::media::vfs::VfsRecord;
use crate::error::AppError;

pub struct VfsRepo;

impl VfsRepo {
    pub async fn fetch_all(db: &impl ConnectionTrait) -> Result<Vec<VfsRecord>, AppError> {
        let models = vfs::Entity::find().all(db).await?;
        Ok(models
            .into_iter()
            .map(|m| VfsRecord {
                id: m.id.to_string(),
                vfs_type: m.r#type,
                config: m.config.unwrap_or(serde_json::json!({})),
            })
            .collect())
    }

    pub async fn fetch_by_id(
        db: &impl ConnectionTrait,
        id: &str,
    ) -> Result<Option<VfsRecord>, AppError> {
        let uuid = uuid::Uuid::parse_str(id).map_err(|_| AppError::BadRequest("invalid vfs id".into()))?;
        let model = vfs::Entity::find_by_id(uuid).one(db).await?;
        Ok(model.map(|m| VfsRecord {
            id: m.id.to_string(),
            vfs_type: m.r#type,
            config: m.config.unwrap_or(serde_json::json!({})),
        }))
    }

    pub async fn patch_config(
        db: &impl ConnectionTrait,
        id: &str,
        patch: serde_json::Value,
    ) -> Result<(), AppError> {
        let uuid = uuid::Uuid::parse_str(id).map_err(|_| AppError::BadRequest("invalid vfs id".into()))?;
        let existing = vfs::Entity::find_by_id(uuid)
            .one(db)
            .await?
            .ok_or_else(|| AppError::NotFound("vfs not found".into()))?;

        let mut config = existing.config.unwrap_or(serde_json::json!({}));
        if let (Some(obj), Some(patch_obj)) = (config.as_object_mut(), patch.as_object()) {
            for (k, v) in patch_obj {
                obj.insert(k.clone(), v.clone());
            }
        }

        let model = vfs::ActiveModel {
            id: Set(uuid),
            config: Set(Some(config)),
            ..Default::default()
        };
        vfs::Entity::update(model).exec(db).await?;
        Ok(())
    }
}
