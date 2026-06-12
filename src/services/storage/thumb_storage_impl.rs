use std::sync::Arc;

use async_trait::async_trait;
use bytes::Bytes;
use tokimo_package_image::ThumbStorage;

use super::{StorageProvider, UploadOptions};

/// Adapter that implements `ThumbStorage` (from `rust-thumbnail`) on top of the
/// server's own `StorageProvider` trait.
///
/// This keeps `rust-thumbnail` independent of the server's internal storage API.
pub struct StorageThumbAdapter(pub Arc<dyn StorageProvider>);

#[async_trait]
impl ThumbStorage for StorageThumbAdapter {
    async fn get(&self, key: &str) -> Option<Bytes> {
        self.0.download(key).await.ok()
    }

    async fn put(&self, key: &str, data: Bytes, content_type: Option<&str>) -> Result<(), String> {
        self.0
            .upload(
                key,
                data,
                Some(UploadOptions {
                    content_type: content_type.map(str::to_string),
                }),
            )
            .await
    }
}
