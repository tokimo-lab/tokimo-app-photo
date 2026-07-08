use sea_orm::EntityTrait;
use serde_json::{Value as JsonValue, json};
use uuid::Uuid;

use crate::AppState;
use crate::bus_clients::jobs;
use crate::bus_clients::media_intelligence as media_bus;
use crate::config::PhotoAiSettings;
use crate::db::entities::{jobs as job_entity, photos};
use crate::error::AppError;
use crate::error::OptionExt;
use crate::queue::JobPriority;

pub enum MediaJobOutcome {
    Completed(JsonValue),
    Waiting(JsonValue),
}

impl MediaJobOutcome {
    pub fn waiting_data(child_job_id: Uuid, child_job_type: &str) -> JsonValue {
        json!({
            "_phase": "waiting",
            "waitChildJobId": child_job_id.to_string(),
            "waitChildJobType": child_job_type,
            "waitReason": "media_job",
        })
    }
}

fn media_job_priority(job_type: &str) -> Option<i32> {
    match job_type {
        "media_ocr_photo" | "media_detect_faces_photo" | "media_embed_image_photo" | "media_extract_gps_photo" => {
            Some(JobPriority::Background.as_i32())
        }
        _ => None,
    }
}

async fn current_wait_child(
    state: &std::sync::Arc<AppState>,
    parent_job_id: Uuid,
) -> Result<Option<job_entity::Model>, AppError> {
    let Some(parent) = job_entity::Entity::find_by_id(parent_job_id).one(&state.db).await? else {
        return Ok(None);
    };
    let Some(child_id) = parent
        .data
        .get("waitChildJobId")
        .and_then(|value| value.as_str())
        .and_then(|value| Uuid::parse_str(value).ok())
    else {
        return Ok(None);
    };
    job_entity::Entity::find_by_id(child_id)
        .one(&state.db)
        .await
        .map_err(Into::into)
}

pub async fn create_media_job_or_wait(
    state: &std::sync::Arc<AppState>,
    user_id: Uuid,
    parent_job_id: Uuid,
    job_type: &str,
    params: JsonValue,
) -> Result<MediaJobOutcome, AppError> {
    if let Some(child) = current_wait_child(state, parent_job_id).await? {
        match child.status.as_str() {
            "completed" => return Ok(MediaJobOutcome::Completed(child.data)),
            "failed" | "cancelled" | "suspended" => {
                return Err(AppError::Internal(format!(
                    "media job {} ended as {}: {}",
                    child.id,
                    child.status,
                    child.error.unwrap_or_default()
                )));
            }
            _ => {
                return Ok(MediaJobOutcome::Waiting(MediaJobOutcome::waiting_data(
                    child.id, job_type,
                )));
            }
        }
    }

    let client = state
        .bus_client
        .get()
        .ok_or_else(|| AppError::Internal("jobs service unavailable".into()))?;
    let mut request = jobs::CreateJobRequest::new(job_type, params);
    request.parent_job_id = Some(parent_job_id);
    request.task_type = Some(job_type.to_string());
    request.priority = media_job_priority(job_type);
    let job = jobs::create(client, jobs::photo_caller(Some(user_id)), request).await?;
    Ok(MediaJobOutcome::Waiting(MediaJobOutcome::waiting_data(
        job.id, job_type,
    )))
}

pub async fn detect_faces_for_photo_job(
    state: &std::sync::Arc<AppState>,
    parent_job_id: Uuid,
    photo_id: Uuid,
    user_id: Uuid,
) -> Result<MediaJobOutcome, AppError> {
    let photo = photos::Entity::find_by_id(photo_id)
        .one(&state.db)
        .await?
        .not_found("Photo not found")?;
    let image_path = photo.thumbnail_path.as_deref().unwrap_or(photo.path.as_str());
    create_media_job_or_wait(
        state,
        user_id,
        parent_job_id,
        "media_detect_faces_photo",
        json!({
            "photoId": photo_id,
            "image": media_bus::image_input_for_photo(&photo, image_path)?,
        }),
    )
    .await
}

pub async fn ocr_photo_job(
    state: &std::sync::Arc<AppState>,
    parent_job_id: Uuid,
    photo_id: Uuid,
    user_id: Uuid,
) -> Result<MediaJobOutcome, AppError> {
    let photo = photos::Entity::find_by_id(photo_id)
        .one(&state.db)
        .await?
        .not_found("Photo not found")?;
    let settings = PhotoAiSettings::for_app(&state.db, photo.app_id).await?;
    let image_path = photo.thumbnail_path.as_deref().unwrap_or(photo.path.as_str());
    create_media_job_or_wait(
        state,
        user_id,
        parent_job_id,
        "media_ocr_photo",
        json!({
            "photoId": photo_id,
            "image": media_bus::image_input_for_photo(&photo, image_path)?,
            "modelName": settings.ocr_model_name,
            "auxModelName": settings.ocr_aux_model_name,
        }),
    )
    .await
}

pub async fn embed_photo_job(
    state: &std::sync::Arc<AppState>,
    parent_job_id: Uuid,
    photo_id: Uuid,
    user_id: Uuid,
) -> Result<MediaJobOutcome, AppError> {
    let photo = photos::Entity::find_by_id(photo_id)
        .one(&state.db)
        .await?
        .not_found("Photo not found")?;
    let image_path = photo.thumbnail_path.as_deref().unwrap_or(photo.path.as_str());
    create_media_job_or_wait(
        state,
        user_id,
        parent_job_id,
        "media_embed_image_photo",
        json!({
            "photoId": photo.id,
            "image": media_bus::image_input_for_photo(&photo, image_path)?,
        }),
    )
    .await
}

pub async fn create_media_job_and_wait(
    state: &std::sync::Arc<AppState>,
    user_id: Uuid,
    job_type: &str,
    params: JsonValue,
) -> Result<JsonValue, AppError> {
    let client = state
        .bus_client
        .get()
        .ok_or_else(|| AppError::Internal("jobs service unavailable".into()))?;
    let request = jobs::CreateJobRequest::new(job_type, params);
    let job = jobs::create(client, jobs::photo_caller(Some(user_id)), request).await?;

    loop {
        tokio::time::sleep(std::time::Duration::from_millis(750)).await;
        let Some(model) = job_entity::Entity::find_by_id(job.id).one(&state.db).await? else {
            return Err(AppError::Internal(format!("media job {} disappeared", job.id)));
        };
        match model.status.as_str() {
            "completed" => return Ok(model.data),
            "failed" | "cancelled" | "suspended" => {
                return Err(AppError::Internal(format!(
                    "media job {} ended as {}: {}",
                    model.id,
                    model.status,
                    model.error.unwrap_or_default()
                )));
            }
            _ => {}
        }
    }
}
