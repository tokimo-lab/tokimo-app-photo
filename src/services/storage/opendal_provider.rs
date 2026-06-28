use bytes::Bytes;
use opendal::{Operator, services::Fs};
use std::path::{Path, PathBuf};

use super::types::{StorageObject, StorageProvider, UploadOptions};

pub struct OpendalStorageProvider {
    op: Operator,
    /// Absolute root on the local filesystem. Kept so we can hand out real
    /// `{root}/{key}` paths to consumers that need a `fs::read`-able path
    /// (e.g. LLM attachment metadata).
    root: PathBuf,
}

impl OpendalStorageProvider {
    pub fn new(root: &Path) -> Result<Self, String> {
        let root_str = root.to_string_lossy();
        let op = Operator::new(Fs::default().root(&root_str))
            .map_err(|e| format!("OpenDAL init failed: {e}"))?
            .finish();
        // Canonicalize when possible so the path we hand out is stable
        // (resolves relative components, symlinks, …). Fall back to the raw
        // path if the dir doesn't exist yet.
        let root_buf = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
        Ok(Self { op, root: root_buf })
    }
}

#[async_trait::async_trait]
impl StorageProvider for OpendalStorageProvider {
    async fn upload(&self, key: &str, body: Bytes, options: Option<UploadOptions>) -> Result<(), String> {
        let content_type = options
            .and_then(|o| o.content_type)
            .unwrap_or_else(|| "application/octet-stream".to_string());

        self.op
            .write_with(key, body)
            .content_type(&content_type)
            .await
            .map(|_| ())
            .map_err(|e| format!("Upload failed: {e}"))
    }

    async fn download(&self, key: &str) -> Result<Bytes, String> {
        let buf = self.op.read(key).await.map_err(|e| format!("Download failed: {e}"))?;
        Ok(buf.to_bytes())
    }

    async fn delete(&self, key: &str) -> Result<(), String> {
        self.op.delete(key).await.map_err(|e| format!("Delete failed: {e}"))
    }

    async fn exists(&self, key: &str) -> Result<bool, String> {
        self.op
            .exists(key)
            .await
            .map_err(|e| format!("Exists check failed: {e}"))
    }

    async fn head(&self, key: &str) -> Result<Option<StorageObject>, String> {
        match self.op.stat(key).await {
            Ok(meta) => Ok(Some(StorageObject {
                key: key.to_string(),
                size: meta.content_length(),
            })),
            Err(e) if e.kind() == opendal::ErrorKind::NotFound => Ok(None),
            Err(e) if e.kind() == opendal::ErrorKind::IsADirectory => Ok(None),
            Err(e) => Err(format!("Head failed: {e}")),
        }
    }

    async fn list(&self, prefix: Option<&str>) -> Result<Vec<StorageObject>, String> {
        // Normalize prefix: ensure it ends with "/" for directory-like listing.
        // Empty string lists the root.
        let prefix = match prefix {
            Some("") | None => String::new(),
            Some(p) if p.ends_with('/') => p.to_string(),
            Some(p) => format!("{p}/"),
        };

        let entries = self
            .op
            .list_with(&prefix)
            .recursive(true)
            .await
            .map_err(|e| format!("List failed: {e}"))?;

        Ok(entries
            .into_iter()
            // Directories end with "/", skip them
            .filter(|e| !e.path().ends_with('/'))
            .map(|e| StorageObject {
                key: e.path().to_string(),
                size: e.metadata().content_length(),
            })
            .collect())
    }

    fn local_absolute_path(&self, key: &str) -> Option<PathBuf> {
        Some(self.root.join(key))
    }
}
