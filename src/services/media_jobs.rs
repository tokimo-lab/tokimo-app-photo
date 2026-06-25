use sea_orm::EntityTrait;
use serde_json::Value as JsonValue;
use uuid::Uuid;

use crate::bus_clients::jobs;
use crate::db::entities::jobs as job_entity;
use crate::error::AppError;
use crate::AppState;

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
    let job = jobs::create(
        client,
        jobs::photo_caller(Some(user_id)),
        jobs::CreateJobRequest::new(job_type, params),
    )
    .await?;

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
