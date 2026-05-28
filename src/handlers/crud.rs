//! Handlers for photo library CRUD.

use std::sync::Arc;

use axum::{Json, extract::{Path, State}};
use serde::Deserialize;
use uuid::Uuid;

use crate::ctx::AppCtx;
use crate::db::{entities::photos, repos::library_repo::{PhotoLibraryRepo, UpdatePhotoLibraryFields}};
use crate::error::{AppError, OptionExt};
use crate::models::{PhotoLibraryOutput, PhotoLibrarySourceOutput};
use sea_orm::{ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter};

use super::{ok, ok_simple, parse_uuid};

// ── Input DTOs ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePhotoLibraryInput {
    pub name: String,
    pub r#type: String,
    pub avatar: Option<serde_json::Value>,
    pub description: Option<String>,
    pub scrape_enabled: Option<bool>,
    pub settings: Option<serde_json::Value>,
    pub sources: Option<Vec<PhotoLibrarySourceInput>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePhotoLibraryInput {
    pub name: Option<String>,
    pub avatar: Option<serde_json::Value>,
    pub description: Option<String>,
    pub scrape_enabled: Option<bool>,
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

// ── Helper ──────────────────────────────────────────────────────────────────

pub fn sources_to_json(sources: &[PhotoLibrarySourceInput]) -> serde_json::Value {
    serde_json::json!(sources
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
        .collect::<Vec<_>>())
}

pub async fn to_photo_library_output(
    ctx: &AppCtx,
    model: crate::db::entities::photo_libraries::Model,
) -> Result<PhotoLibraryOutput, AppError> {
    let lib_id = model.id;
    let source_tuples = PhotoLibraryRepo::parse_sources(&model.sources);

    let mut sources: Vec<PhotoLibrarySourceOutput> = Vec::with_capacity(source_tuples.len());
    for (idx, (source_id, root_path, is_default_download)) in source_tuples.iter().enumerate() {
        // Try to resolve VFS source info via the bus client (best-effort).
        let (source_name, source_type) = if let Ok(client) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| ctx.client())) {
            match crate::bus_clients::vfs::get_driver_config(
                &client,
                crate::bus_clients::vfs::photo_caller(),
                *source_id,
            )
            .await
            {
                Ok(cfg) => (Some(cfg.driver_name.clone()), Some(cfg.driver_name)),
                Err(_) => (None, None),
            }
        } else {
            (None, None)
        };
        sources.push(PhotoLibrarySourceOutput {
            source_id: source_id.to_string(),
            root_path: root_path.clone(),
            sort_order: idx as i32,
            is_default_download: *is_default_download,
            source_name,
            source_type,
        });
    }

    let item_count = photos::Entity::find()
        .filter(photos::Column::AppId.eq(lib_id))
        .filter(photos::Column::DeletedAt.is_null())
        .count(&ctx.db)
        .await? as i64;

    let created_at = model
        .created_at
        .map(|d| d.to_rfc3339())
        .unwrap_or_default();
    let updated_at = model
        .updated_at
        .map(|d| d.to_rfc3339())
        .unwrap_or_default();

    Ok(PhotoLibraryOutput {
        id: model.id.to_string(),
        name: model.name,
        r#type: model.r#type,
        avatar: model.avatar,
        description: model.description,
        poster_path: model.poster_path,
        scrape_enabled: model.scrape_enabled,
        sort_order: model.sort_order,
        settings: model.settings,
        sync_status: model.sync_status,
        last_sync_at: model.last_sync_at.map(|d| d.to_rfc3339()),
        item_count,
        sources,
        created_at,
        updated_at,
    })
}

// ── Handlers ────────────────────────────────────────────────────────────────

pub async fn list_photo_libraries(
    State(ctx): State<Arc<AppCtx>>,
) -> Result<Json<serde_json::Value>, AppError> {
    let rows = PhotoLibraryRepo::list_all(&ctx.db).await?;
    let mut outputs = Vec::with_capacity(rows.len());
    for row in rows {
        outputs.push(to_photo_library_output(&ctx, row).await?);
    }
    ok(outputs)
}

pub async fn get_photo_library(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let uid = parse_uuid(&id)?;
    let model = PhotoLibraryRepo::get_by_id(&ctx.db, uid)
        .await?
        .not_found(format!("photo library {id} not found"))?;
    ok(to_photo_library_output(&ctx, model).await?)
}

pub async fn create_photo_library(
    State(ctx): State<Arc<AppCtx>>,
    Json(body): Json<CreatePhotoLibraryInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    let model = PhotoLibraryRepo::create(&ctx.db, body.name, body.r#type, body.settings).await?;
    let lib_id = model.id;

    let mut update_fields = UpdatePhotoLibraryFields {
        name: None,
        description: body.description,
        avatar: body.avatar,
        poster_path: None,
        scrape_enabled: body.scrape_enabled,
        settings: None,
        sources: None,
    };

    if let Some(sources) = body.sources {
        for s in &sources {
            let _: Uuid = s
                .source_id
                .parse()
                .map_err(|_| AppError::BadRequest("invalid source_id".into()))?;
        }
        update_fields.sources = Some(sources_to_json(&sources));
    }

    if update_fields.description.is_some()
        || update_fields.avatar.is_some()
        || update_fields.scrape_enabled.is_some()
        || update_fields.sources.is_some()
    {
        PhotoLibraryRepo::update(&ctx.db, lib_id, update_fields).await?;
    }

    let model = PhotoLibraryRepo::get_by_id(&ctx.db, lib_id)
        .await?
        .internal("failed to fetch created photo library")?;
    ok(to_photo_library_output(&ctx, model).await?)
}

pub async fn update_photo_library(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Json(body): Json<UpdatePhotoLibraryInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    let uid = parse_uuid(&id)?;

    let mut update_fields = UpdatePhotoLibraryFields {
        name: body.name,
        description: body.description,
        avatar: body.avatar,
        poster_path: None,
        scrape_enabled: body.scrape_enabled,
        settings: body.settings,
        sources: None,
    };

    if let Some(sources) = body.sources {
        for s in &sources {
            let _: Uuid = s
                .source_id
                .parse()
                .map_err(|_| AppError::BadRequest("invalid source_id".into()))?;
        }
        update_fields.sources = Some(sources_to_json(&sources));
    }

    PhotoLibraryRepo::update(&ctx.db, uid, update_fields).await?;

    let model = PhotoLibraryRepo::get_by_id(&ctx.db, uid)
        .await?
        .internal("failed to fetch updated photo library")?;
    ok(to_photo_library_output(&ctx, model).await?)
}

pub async fn delete_photo_library(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let uid = parse_uuid(&id)?;
    PhotoLibraryRepo::delete(&ctx.db, uid).await?;
    ok_simple()
}

pub async fn reorder_photo_libraries(
    State(ctx): State<Arc<AppCtx>>,
    Json(body): Json<PhotoLibraryReorderInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    let orders: Vec<(Uuid, i32)> = body
        .orders
        .into_iter()
        .filter_map(|item| {
            item.id.parse::<Uuid>().ok().map(|uid| (uid, item.sort_order))
        })
        .collect();
    PhotoLibraryRepo::reorder(&ctx.db, orders).await?;
    ok_simple()
}
