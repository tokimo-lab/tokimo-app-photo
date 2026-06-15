//! Artwork upload helpers.

use bytes::Bytes;
use std::sync::Arc;

use crate::services::storage::{StorageProvider, UploadOptions};

use super::constants::image_mime;

/// Upload a local image buffer to S3 and return the storage path.
pub async fn upload_image_buffer(
    storage: &Arc<dyn StorageProvider>,
    buf: &[u8],
    storage_key: &str,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let ext = storage_key.rsplit('.').next().unwrap_or("jpg");
    let mime = image_mime(ext);
    storage
        .upload(
            storage_key,
            Bytes::from(buf.to_vec()),
            Some(UploadOptions {
                content_type: Some(mime.to_string()),
            }),
        )
        .await
        .map_err(|e| format!("Storage upload failed: {e}"))?;
    Ok(format!("/storage/{storage_key}"))
}
