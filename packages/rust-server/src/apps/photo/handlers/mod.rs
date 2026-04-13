pub mod album;
pub mod ai;
pub mod batch;
pub mod browse;
pub mod crud;
pub mod geo;
pub mod person;
pub mod stream;
pub mod sync;

use serde::Deserialize;
use uuid::Uuid;

use crate::db::entities::vfs;
use crate::apps::photo::models::PhotoLibraryOutput;
use crate::apps::photo::repos::PhotoLibraryRepo;
use crate::db::{ApiDateTimeExt, OptionalApiDateTimeExt};
use crate::error::AppError;

pub use album::*;
pub use ai::*;
pub use batch::*;
pub use browse::*;
pub use crud::*;
pub use geo::*;
pub use person::*;
pub use stream::*;
pub use sync::*;

// ── Input DTOs ──

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePhotoLibraryInput {
    pub name: String,
    pub r#type: String,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub description: Option<String>,
    pub scrape_enabled: Option<bool>,
    pub scrape_agents: Option<Vec<String>>,
    pub settings: Option<serde_json::Value>,
    pub sources: Option<Vec<PhotoLibrarySourceInput>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePhotoLibraryInput {
    pub name: Option<String>,
    pub r#type: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub description: Option<String>,
    pub scrape_enabled: Option<bool>,
    pub scrape_agents: Option<Vec<String>>,
    pub settings: Option<serde_json::Value>,
    pub sources: Option<Vec<PhotoLibrarySourceInput>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoLibrarySourceInput {
    pub source_id: String,
    pub root_path: String,
    pub sort_order: i32,
    pub is_default_download: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoLibraryReorderInput {
    pub orders: Vec<PhotoLibraryReorderItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoLibraryReorderItem {
    pub id: String,
    pub sort_order: i32,
}

// ── Shared helpers ──

pub(crate) fn parse_uuid(s: &str) -> Result<Uuid, AppError> {
    s.parse::<Uuid>()
        .map_err(|_| AppError::BadRequest(format!("invalid uuid: {s}")))
}

/// Build sources JSON from input.
pub(crate) fn sources_to_json(sources: &[PhotoLibrarySourceInput]) -> serde_json::Value {
    serde_json::json!(
        sources
            .iter()
            .enumerate()
            .map(|(i, s)| {
                serde_json::json!({
                    "sourceId": s.source_id,
                    "rootPath": s.root_path,
                    "sortOrder": s.sort_order.max(i as i32),
                    "isDefaultDownload": s.is_default_download.unwrap_or(false),
                })
            })
            .collect::<Vec<_>>()
    )
}

/// Convert a `photo_libraries::Model` into a `PhotoLibraryOutput` DTO.
pub(crate) async fn to_photo_library_output(
    db: &sea_orm::DatabaseConnection,
    model: crate::db::entities::photo_libraries::Model,
) -> Result<PhotoLibraryOutput, AppError> {
    use sea_orm::{EntityTrait, QueryFilter, ColumnTrait, PaginatorTrait};
    use crate::db::entities::photos;

    let lib_id = model.id;

    let source_tuples = PhotoLibraryRepo::parse_sources(&model.sources);
    let mut sources = Vec::with_capacity(source_tuples.len());
    for (source_id, root_path, is_default_download) in &source_tuples {
        let fs = vfs::Entity::find_by_id(*source_id).one(db).await?;
        sources.push(crate::apps::photo::models::PhotoLibrarySourceOutput {
            source_id: source_id.to_string(),
            root_path: root_path.clone(),
            sort_order: sources.len() as i32,
            is_default_download: *is_default_download,
            source_name: fs.as_ref().map(|f| f.name.clone()),
            source_type: fs.as_ref().map(|f| f.r#type.clone()),
        });
    }

    let item_count = photos::Entity::find()
        .filter(photos::Column::AppId.eq(lib_id))
        .filter(photos::Column::DeletedAt.is_null())
        .count(db)
        .await? as i64;

    Ok(PhotoLibraryOutput {
        id: model.id.to_string(),
        name: model.name,
        r#type: model.r#type,
        icon: model.icon,
        color: model.color,
        description: model.description,
        poster_path: model.poster_path,
        scrape_enabled: model.scrape_enabled,
        scrape_agents: model.scrape_agents,
        sort_order: model.sort_order,
        settings: model.settings,
        sync_status: model.sync_status,
        last_sync_at: model.last_sync_at.to_api_datetime(),
        item_count,
        sources,
        created_at: model.created_at.to_api_datetime_or_default(),
        updated_at: model.updated_at.to_api_datetime_or_default(),
    })
}

/// Build `PhotoLibraryOutput` for a list of models.
pub(crate) async fn to_photo_library_outputs(
    db: &sea_orm::DatabaseConnection,
    models: Vec<crate::db::entities::photo_libraries::Model>,
) -> Result<Vec<PhotoLibraryOutput>, AppError> {
    let mut outputs = Vec::with_capacity(models.len());
    for model in models {
        outputs.push(to_photo_library_output(db, model).await?);
    }
    Ok(outputs)
}
