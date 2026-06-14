//! `SeaORM` Entity for book_chapters table.

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "book_chapters")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub book_id: Uuid,
    pub index: i32,
    #[sea_orm(column_type = "Text", nullable)]
    pub title: Option<String>,
    pub start_time: i32,
    pub end_time: Option<i32>,
    #[sea_orm(column_type = "Text", nullable)]
    pub thumb_path: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
