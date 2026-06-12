// Removed: replaced by opendal_provider.rs

impl S3StorageProvider {
    pub fn new(config: &serde_json::Value) -> Result<Self, String> {
        let driver =
            S3Driver::from_config(config).map_err(|e| format!("S3 driver init failed: {e}"))?;
        Ok(Self { driver })
    }

    pub async fn ensure_bucket(&self) -> Result<(), String> {
        self.driver
            .list_prefix(Some(""))
            .await
            .map_err(|e| format!("Bucket not accessible: {e}"))?;
        Ok(())
    }
}

#[async_trait::async_trait]
impl StorageProvider for S3StorageProvider {
    async fn upload(
        &self,
        key: &str,
        body: Bytes,
        options: Option<UploadOptions>,
    ) -> Result<(), String> {
        let content_type = options
            .and_then(|o| o.content_type)
            .unwrap_or_else(|| "application/octet-stream".to_string());

        self.driver
            .put_object(key, &body, &content_type)
            .await
            .map_err(|e| format!("S3 upload failed: {e}"))?;

        Ok(())
    }

    async fn download(&self, key: &str) -> Result<Bytes, String> {
        let data = self
            .driver
            .get_key(key)
            .await
            .map_err(|e| format!("S3 download failed: {e}"))?;
        Ok(Bytes::from(data))
    }

    async fn delete(&self, key: &str) -> Result<(), String> {
        self.driver
            .delete_key(key)
            .await
            .map_err(|e| format!("S3 delete failed: {e}"))?;
        Ok(())
    }

    async fn exists(&self, key: &str) -> Result<bool, String> {
        self.driver
            .head_key(key)
            .await
            .map_err(|e| format!("S3 exists check failed: {e}"))
    }

    async fn head(&self, key: &str) -> Result<Option<StorageObject>, String> {
        match self.driver.head_key(key).await {
            Ok(true) => {
                // S3 head_key doesn't return size; use list to get it
                let objects = self
                    .driver
                    .list_prefix(Some(key))
                    .await
                    .map_err(|e| format!("S3 head list failed: {e}"))?;
                let size = objects.iter().find(|(k, _)| k == key).map_or(0, |(_, s)| *s);
                Ok(Some(StorageObject {
                    key: key.to_string(),
                    size,
                }))
            }
            Ok(false) => Ok(None),
            Err(e) => Err(format!("S3 head failed: {e}")),
        }
    }

    async fn list(&self, prefix: Option<&str>) -> Result<Vec<StorageObject>, String> {
        let objects = self
            .driver
            .list_prefix(prefix)
            .await
            .map_err(|e| format!("S3 list failed: {e}"))?;
        Ok(objects
            .into_iter()
            .map(|(key, size)| StorageObject { key, size })
            .collect())
    }
}

