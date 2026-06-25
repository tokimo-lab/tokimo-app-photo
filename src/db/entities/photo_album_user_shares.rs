//! `SeaORM` Entity for photo_album_user_shares table.

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "photo_album_user_shares")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub album_id: Uuid,
    pub user_id: Uuid,
    #[sea_orm(column_type = "Text")]
    pub permission: String,
    pub created_by: Option<Uuid>,
    pub created_at: DateTimeWithTimeZone,
    pub updated_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::photo_albums::Entity",
        from = "Column::AlbumId",
        to = "super::photo_albums::Column::Id",
        on_update = "Cascade",
        on_delete = "Cascade"
    )]
    PhotoAlbums,
}

impl Related<super::photo_albums::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::PhotoAlbums.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
