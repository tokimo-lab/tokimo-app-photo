//! Typed JSON settings repo, sidecar-owned.
//!
//! 1:1 port of the host's `SystemConfigRepo` semantics
//! (scope + scope_id → JSON value) but with a single flat dotted-key string
//! (`"photo.ai"`, `"photo.geo"`) so the sidecar doesn't have to bridge to
//! the host's `system_config` table.
//!
//! Usage:
//! ```ignore
//! impl AppSettingsSection for PhotoAiSettings {
//!     const KEY: &'static str = "photo.ai";
//!     fn default_value() -> Self { ... }
//! }
//!
//! let s: PhotoAiSettings = AppSettingsRepo::get(&db).await?;
//! AppSettingsRepo::set(&db, &s).await?;
//! ```

use chrono::Utc;
use sea_orm::sea_query::OnConflict;
use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, Set};
use serde::{Serialize, de::DeserializeOwned};

use crate::db::entities::app_settings;
use crate::error::AppError;

/// Every typed settings struct stored under a single dotted key.
pub trait AppSettingsSection: Serialize + DeserializeOwned + Send + Sync {
    /// Dotted key (e.g. `"photo.ai"`, `"photo.geo"`). Globally unique
    /// within this sidecar's `app_settings` table.
    const KEY: &'static str;

    /// Value returned by [`AppSettingsRepo::get`] when the row is missing.
    fn default_value() -> Self;
}

pub struct AppSettingsRepo;

impl AppSettingsRepo {
    /// Get a typed section, returning [`AppSettingsSection::default_value`] when
    /// the row doesn't exist yet.
    pub async fn get<T: AppSettingsSection>(db: &impl ConnectionTrait) -> Result<T, AppError> {
        match app_settings::Entity::find_by_id(T::KEY.to_string())
            .one(db)
            .await?
        {
            Some(m) => Ok(serde_json::from_value(m.value)?),
            None => Ok(T::default_value()),
        }
    }

    /// Get a typed section, returning `None` when the row doesn't exist.
    #[allow(dead_code)]
    pub async fn get_optional<T: AppSettingsSection>(
        db: &impl ConnectionTrait,
    ) -> Result<Option<T>, AppError> {
        match app_settings::Entity::find_by_id(T::KEY.to_string())
            .one(db)
            .await?
        {
            Some(m) => Ok(Some(serde_json::from_value(m.value)?)),
            None => Ok(None),
        }
    }

    /// Write (upsert) a typed section.
    pub async fn set<T: AppSettingsSection>(
        db: &impl ConnectionTrait,
        value: &T,
    ) -> Result<(), AppError> {
        let json = serde_json::to_value(value)?;
        Self::set_raw(db, T::KEY, json).await
    }

    /// Raw upsert by key. Public for tests / migration helpers.
    pub async fn set_raw(
        db: &impl ConnectionTrait,
        key: &str,
        value: serde_json::Value,
    ) -> Result<(), AppError> {
        let now = Utc::now().fixed_offset();
        let am = app_settings::ActiveModel {
            key: Set(key.to_string()),
            value: Set(value),
            created_at: Set(now),
            updated_at: Set(now),
        };
        app_settings::Entity::insert(am)
            .on_conflict(
                OnConflict::column(app_settings::Column::Key)
                    .update_columns([app_settings::Column::Value, app_settings::Column::UpdatedAt])
                    .to_owned(),
            )
            .exec(db)
            .await?;
        Ok(())
    }

    /// Delete a row by key. Returns the number of rows removed (0 or 1).
    #[allow(dead_code)]
    pub async fn delete(db: &impl ConnectionTrait, key: &str) -> Result<u64, AppError> {
        let res = app_settings::Entity::delete_many()
            .filter(app_settings::Column::Key.eq(key))
            .exec(db)
            .await?;
        Ok(res.rows_affected)
    }
}
