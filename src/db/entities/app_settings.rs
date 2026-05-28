//! `app_settings` entity — single-key JSONB settings storage owned by the sidecar.
//!
//! Replaces the host-side `system_config` (scope, scope_id) compound key with a
//! flat dotted-key string. Typed access lives in
//! [`crate::db::repos::app_settings_repo::AppSettingsRepo`].

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "app_settings")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub key: String,
    pub value: serde_json::Value,
    pub created_at: chrono::DateTime<chrono::FixedOffset>,
    pub updated_at: chrono::DateTime<chrono::FixedOffset>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
