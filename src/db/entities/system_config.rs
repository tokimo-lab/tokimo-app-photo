//! System config entity — key-value JSONB settings storage.
//! This table lives in the `public` schema and is shared across all apps.

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "system_config")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub scope: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub scope_id: String,
    #[sea_orm(column_type = "JsonBinary")]
    pub value: Json,
    pub created_at: Option<DateTimeWithTimeZone>,
    pub updated_at: Option<DateTimeWithTimeZone>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
