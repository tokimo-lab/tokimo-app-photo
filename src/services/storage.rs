//! Storage provider abstraction for object storage (S3, local filesystem, etc.).

use bytes::Bytes;

/// Options for uploading objects.
#[derive(Debug, Clone)]
pub struct UploadOptions {
    pub content_type: Option<String>,
}

/// Stored object metadata.
#[derive(Debug, Clone)]
pub struct StoredObject {
    pub key: String,
}

/// Trait for pluggable object storage backends.
#[async_trait::async_trait]
pub trait StorageProvider: Send + Sync {
    /// Download an object by key.
    async fn download(&self, key: &str) -> Result<Bytes, Box<dyn std::error::Error + Send + Sync>>;
    /// Upload an object.
    async fn upload(&self, key: &str, data: Bytes, options: Option<UploadOptions>) -> Result<(), Box<dyn std::error::Error + Send + Sync>>;
    /// Delete an object.
    async fn delete(&self, key: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>>;
    /// List objects with optional prefix.
    async fn list(&self, prefix: Option<&str>) -> Result<Vec<StoredObject>, Box<dyn std::error::Error + Send + Sync>>;
}

/// Local filesystem storage implementation.
pub struct LocalStorage {
    base_path: String,
}

impl LocalStorage {
    pub fn new(base_path: String) -> Self {
        Self { base_path }
    }
}

#[async_trait::async_trait]
impl StorageProvider for LocalStorage {
    async fn download(&self, key: &str) -> Result<Bytes, Box<dyn std::error::Error + Send + Sync>> {
        let path = format!("{}/{}", self.base_path, key);
        let data = tokio::fs::read(&path).await?;
        Ok(Bytes::from(data))
    }

    async fn upload(&self, key: &str, data: Bytes, _options: Option<UploadOptions>) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let path = format!("{}/{}", self.base_path, key);
        if let Some(parent) = std::path::Path::new(&path).parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        tokio::fs::write(&path, &data).await?;
        Ok(())
    }

    async fn delete(&self, key: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let path = format!("{}/{}", self.base_path, key);
        let _ = tokio::fs::remove_file(&path).await;
        Ok(())
    }

    async fn list(&self, prefix: Option<&str>) -> Result<Vec<StoredObject>, Box<dyn std::error::Error + Send + Sync>> {
        let dir = match prefix {
            Some(p) => format!("{}/{}", self.base_path, p),
            None => self.base_path.clone(),
        };
        let mut entries = Vec::new();
        let mut read_dir = match tokio::fs::read_dir(&dir).await {
            Ok(rd) => rd,
            Err(_) => return Ok(entries),
        };
        while let Some(entry) = read_dir.next_entry().await? {
            if entry.file_type().await?.is_file() {
                let key = entry.file_name().to_string_lossy().to_string();
                entries.push(StoredObject {
                    key: if let Some(p) = prefix {
                        format!("{p}/{key}")
                    } else {
                        key
                    },
                });
            }
        }
        Ok(entries)
    }
}
