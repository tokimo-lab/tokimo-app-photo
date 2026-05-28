//! `SeaORM` Entity — photo_geo_cache table.

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "photo_geo_cache")]
#[allow(dead_code)]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    #[sea_orm(column_type = "Text", unique_key = "photo_geo_cache_lat_key_lon_key_key")]
    pub lat_key: String,
    #[sea_orm(column_type = "Text", unique_key = "photo_geo_cache_lat_key_lon_key_key")]
    pub lon_key: String,
    #[sea_orm(column_type = "Text", nullable)]
    pub province: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub city: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub district: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub township: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub adcode: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub address: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub country: Option<String>,
    pub created_at: DateTimeWithTimeZone,
}

#[allow(dead_code)]
#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
