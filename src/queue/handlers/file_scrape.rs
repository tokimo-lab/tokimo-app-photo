use sea_orm::DatabaseConnection;
use serde_json::Value as JsonValue;
use std::sync::Arc;
use tokio_util::sync::CancellationToken;
use tracing::warn;
use uuid::Uuid;

use crate::AppState;
use crate::queue::cancellation::check_cancel;
use crate::services::scrape::photo;
use crate::services::scrape::shared::constants::is_photo_file;

type BoxError = Box<dyn std::error::Error + Send + Sync>;

pub async fn handle(
    db: &DatabaseConnection,
    state: &Arc<AppState>,
    job_id: Uuid,
    params: &JsonValue,
    cancel: &CancellationToken,
    user_id: Option<Uuid>,
) -> Result<(), BoxError> {
    let _ = job_id;
    check_cancel(cancel)?;

    let file_path = params
        .get("filePath")
        .and_then(|v| v.as_str())
        .ok_or("Missing filePath")?;
    let file_size = params.get("fileSize").and_then(JsonValue::as_i64).unwrap_or(0);
    let source_id = params
        .get("sourceId")
        .and_then(|v| v.as_str())
        .ok_or("Missing sourceId")?;
    let source_uuid = Uuid::parse_str(source_id)?;

    let filename = file_path.rsplit('/').next().unwrap_or(file_path);
    if !is_photo_file(filename) {
        warn!("[file_scrape] Not a photo file, skipping: {file_path}");
        return Ok(());
    }

    let app_uuid = params
        .get("photoId")
        .and_then(|v| v.as_str())
        .ok_or("Missing photoId")?;
    let app_uuid = Uuid::parse_str(app_uuid)?;

    photo::handle(
        db,
        state,
        source_id,
        app_uuid,
        source_uuid,
        file_path,
        file_size,
        user_id,
    )
    .await?;
    Ok(())
}
