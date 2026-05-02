use axum::{
    extract::{Path, State},
    response::Json,
};
use std::sync::Arc;
use uuid::Uuid;

use crate::AppState;
use crate::apps::photo::models::PhotoLibraryOutput;
use crate::apps::photo::repos::{PhotoLibraryRepo, UpdatePhotoLibraryFields};
use crate::error::AppError;
use crate::error::OptionExt;
use crate::handlers::{ApiResponse, ok, ok_empty};
use crate::services::media::source::normalize_source_path;

use super::{
    CreatePhotoLibraryInput, PhotoLibraryReorderInput, UpdatePhotoLibraryInput, parse_uuid, sources_to_json,
    to_photo_library_output, to_photo_library_outputs,
};

/// GET /api/apps/photo
pub async fn list_photo_libraries(
    State(state): State<Arc<AppState>>,
) -> Result<Json<ApiResponse<Vec<PhotoLibraryOutput>>>, AppError> {
    let rows = PhotoLibraryRepo::list_all(&state.db).await?;
    let outputs = to_photo_library_outputs(&state.db, rows).await?;
    Ok(ok(outputs))
}

/// GET /api/apps/photo/{id}
pub async fn get_photo_library(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<PhotoLibraryOutput>>, AppError> {
    let uid = parse_uuid(&id)?;
    let model = PhotoLibraryRepo::get_by_id(&state.db, uid)
        .await?
        .not_found(format!("photo library {id} not found"))?;
    let output = to_photo_library_output(&state.db, model).await?;
    Ok(ok(output))
}

/// POST /api/apps/photo
pub async fn create_photo_library(
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreatePhotoLibraryInput>,
) -> Result<Json<ApiResponse<PhotoLibraryOutput>>, AppError> {
    let model = PhotoLibraryRepo::create(&state.db, body.name, body.r#type, body.settings).await?;
    let lib_id = model.id;

    let mut needs_update = false;
    let mut update_fields = UpdatePhotoLibraryFields {
        name: None,
        description: body.description,
        avatar: body.avatar,
        poster_path: None,
        scrape_enabled: body.scrape_enabled,
        scrape_agents: body.scrape_agents,
        settings: None,
        sources: None,
    };

    if update_fields.avatar.is_some()
        || update_fields.description.is_some()
        || update_fields.scrape_enabled.is_some()
        || update_fields.scrape_agents.is_some()
    {
        needs_update = true;
    }

    if let Some(sources) = body.sources {
        for s in &sources {
            let _: Uuid = s
                .source_id
                .parse()
                .map_err(|_| AppError::BadRequest("invalid source_id".into()))?;
            normalize_source_path(&s.root_path).map_err(AppError::BadRequest)?;
        }
        update_fields.sources = Some(sources_to_json(&sources));
        needs_update = true;
    }

    if needs_update {
        PhotoLibraryRepo::update(&state.db, lib_id, update_fields).await?;
    }

    let model = PhotoLibraryRepo::get_by_id(&state.db, lib_id)
        .await?
        .internal("failed to fetch created photo library")?;
    let output = to_photo_library_output(&state.db, model).await?;
    Ok(ok(output))
}

/// PATCH /api/apps/photo/{id}
pub async fn update_photo_library(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(body): Json<UpdatePhotoLibraryInput>,
) -> Result<Json<ApiResponse<PhotoLibraryOutput>>, AppError> {
    let uid = parse_uuid(&id)?;

    let _existing = PhotoLibraryRepo::get_by_id(&state.db, uid)
        .await?
        .not_found(format!("photo library {id} not found"))?;

    let mut update_fields = UpdatePhotoLibraryFields {
        name: body.name,
        description: body.description,
        avatar: body.avatar,
        poster_path: None,
        scrape_enabled: body.scrape_enabled,
        scrape_agents: body.scrape_agents,
        settings: body.settings,
        sources: None,
    };

    if let Some(ref sources) = body.sources {
        for s in sources {
            let _: Uuid = s
                .source_id
                .parse()
                .map_err(|_| AppError::BadRequest("invalid source_id".into()))?;
            normalize_source_path(&s.root_path).map_err(AppError::BadRequest)?;
        }
        update_fields.sources = Some(sources_to_json(sources));
    }

    PhotoLibraryRepo::update(&state.db, uid, update_fields).await?;

    let model = PhotoLibraryRepo::get_by_id(&state.db, uid)
        .await?
        .internal("failed to fetch updated photo library")?;
    let output = to_photo_library_output(&state.db, model).await?;
    Ok(ok(output))
}

/// DELETE /api/apps/photo/{id}
pub async fn delete_photo_library(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let uid = parse_uuid(&id)?;
    PhotoLibraryRepo::delete(&state.db, uid).await?;
    Ok(ok_empty())
}

/// POST /api/apps/photo/reorder
pub async fn reorder_photo_libraries(
    State(state): State<Arc<AppState>>,
    Json(body): Json<PhotoLibraryReorderInput>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let orders: Vec<(Uuid, i32)> = body
        .orders
        .into_iter()
        .filter_map(|item| item.id.parse::<Uuid>().ok().map(|uid| (uid, item.sort_order)))
        .collect();
    PhotoLibraryRepo::reorder(&state.db, orders).await?;
    Ok(ok_empty())
}
