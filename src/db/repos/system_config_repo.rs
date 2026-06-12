use sea_orm::*;
use serde::{Serialize, de::DeserializeOwned};

use crate::db::entities::system_config;
use crate::error::AppError;

/// Every typed config section implements this trait.
pub trait SystemConfigSection: Serialize + DeserializeOwned + Send + Sync {
    const SCOPE: &'static str;
    const SCOPE_ID: &'static str;
    fn default_value() -> Self;
}

pub struct SystemConfigRepo;

impl SystemConfigRepo {
    /// Get a typed config section (returns default if not stored yet).
    pub async fn get<T: SystemConfigSection>(db: &impl ConnectionTrait) -> Result<T, AppError> {
        let row = system_config::Entity::find_by_id((T::SCOPE.to_string(), T::SCOPE_ID.to_string()))
            .one(db)
            .await?;
        match row {
            Some(m) => Ok(serde_json::from_value(m.value)?),
            None => Ok(T::default_value()),
        }
    }

    /// Write (upsert) a typed config section.
    pub async fn set<T: SystemConfigSection>(db: &impl ConnectionTrait, value: &T) -> Result<(), AppError> {
        let json = serde_json::to_value(value)?;
        let now = chrono::Utc::now().fixed_offset();
        let active = system_config::ActiveModel {
            scope: Set(T::SCOPE.to_string()),
            scope_id: Set(T::SCOPE_ID.to_string()),
            value: Set(json),
            created_at: Set(Some(now)),
            updated_at: Set(Some(now)),
        };
        system_config::Entity::insert(active)
            .on_conflict(
                sea_orm::sea_query::OnConflict::columns([
                    system_config::Column::Scope,
                    system_config::Column::ScopeId,
                ])
                .update_column(system_config::Column::Value)
                .update_column(system_config::Column::UpdatedAt)
                .to_owned(),
            )
            .exec(db)
            .await?;
        Ok(())
    }
}
