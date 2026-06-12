//! Jobs entity — represents a background job.
//! This table lives in the `public` schema and is shared across all apps.

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "jobs")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    #[sea_orm(column_type = "Text")]
    pub r#type: String,
    #[sea_orm(column_type = "Text")]
    pub status: String,
    pub user_id: Option<Uuid>,
    #[sea_orm(column_type = "Text", nullable)]
    pub app_id: Option<String>,
    pub parent_job_id: Option<Uuid>,
    #[sea_orm(column_type = "Text", nullable)]
    pub task_type: Option<String>,
    #[sea_orm(column_type = "JsonBinary")]
    pub data: Json,
    #[sea_orm(column_type = "JsonBinary", nullable)]
    pub params: Option<Json>,
    pub progress: i32,
    pub retry_count: i32,
    pub max_retries: i32,
    #[sea_orm(column_type = "Text", nullable)]
    pub error: Option<String>,
    pub started_at: Option<DateTimeWithTimeZone>,
    pub completed_at: Option<DateTimeWithTimeZone>,
    pub created_at: DateTimeWithTimeZone,
    pub updated_at: DateTimeWithTimeZone,
    #[sea_orm(column_type = "Text", nullable)]
    pub dedupe_key: Option<String>,
    pub alias_job_id: Option<Uuid>,
    pub priority: i32,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
