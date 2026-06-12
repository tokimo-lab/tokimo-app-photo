// Removed: replaced by opendal_provider.rs

pub struct LocalStorageProvider {
    base_path: PathBuf,
}

impl LocalStorageProvider {
    pub fn new(base_path: String) -> Self {
        Self {
            base_path: PathBuf::from(base_path),
        }
    }

    /// 解析 key 为绝对路径，并做路径穿越检查。
    fn resolve(&self, key: &str) -> Result<PathBuf, String> {
        let resolved = self.base_path.join(key);
        let canonical_base = self
            .base_path
            .canonicalize()
            .unwrap_or_else(|_| self.base_path.clone());

        // 对于还不存在的文件，逐级检查父目录
        let check_path = if resolved.exists() {
            resolved
                .canonicalize()
                .map_err(|e| format!("Failed to canonicalize path: {e}"))?
        } else {
            // 找到已存在的最近祖先目录来 canonicalize
            let mut ancestor = resolved.clone();
            loop {
                if ancestor.exists() {
                    let canon = ancestor
                        .canonicalize()
                        .map_err(|e| format!("Failed to canonicalize ancestor: {e}"))?;
                    // 把剩余的相对路径追加上去
                    let remainder = resolved.strip_prefix(&ancestor).unwrap_or(Path::new(""));
                    break canon.join(remainder);
                }
                if !ancestor.pop() {
                    break resolved.clone();
                }
            }
        };

        if !check_path.starts_with(&canonical_base) {
            return Err("Invalid storage key: path traversal detected".to_string());
        }

        Ok(resolved)
    }
}

#[async_trait::async_trait]
impl StorageProvider for LocalStorageProvider {
    async fn upload(
        &self,
        key: &str,
        body: Bytes,
        _options: Option<UploadOptions>,
    ) -> Result<(), String> {
        let file_path = self.resolve(key)?;

        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("Failed to create directory: {e}"))?;
        }

        fs::write(&file_path, &body)
            .await
            .map_err(|e| format!("Failed to write file: {e}"))?;

        Ok(())
    }

    async fn download(&self, key: &str) -> Result<Bytes, String> {
        let file_path = self.resolve(key)?;
        let data = fs::read(&file_path)
            .await
            .map_err(|e| format!("File not found or read error: {e}"))?;
        Ok(Bytes::from(data))
    }

    async fn delete(&self, key: &str) -> Result<(), String> {
        let file_path = self.resolve(key)?;
        if file_path.exists() {
            fs::remove_file(&file_path)
                .await
                .map_err(|e| format!("Failed to delete file: {e}"))?;
        } else {
            warn!("LocalStorage delete: file not found: {}", file_path.display());
        }
        Ok(())
    }

    async fn exists(&self, key: &str) -> Result<bool, String> {
        let file_path = self.resolve(key)?;
        Ok(file_path.exists())
    }

    async fn head(&self, key: &str) -> Result<Option<StorageObject>, String> {
        let file_path = self.resolve(key)?;
        match tokio::fs::metadata(&file_path).await {
            Ok(meta) if meta.is_file() => Ok(Some(StorageObject {
                key: key.to_string(),
                size: meta.len(),
            })),
            Ok(_) => Ok(None), // directory
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(format!("Head failed: {e}")),
        }
    }

    async fn list(&self, prefix: Option<&str>) -> Result<Vec<StorageObject>, String> {
        let dir = match prefix {
            Some(p) => self.resolve(p)?,
            None => self.base_path.clone(),
        };

        if !dir.exists() {
            return Ok(Vec::new());
        }

        let mut results = Vec::new();
        let mut entries = fs::read_dir(&dir)
            .await
            .map_err(|e| format!("Failed to read directory: {e}"))?;

        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|e| format!("Failed to read entry: {e}"))?
        {
            let meta = entry
                .metadata()
                .await
                .map_err(|e| format!("Failed to read metadata: {e}"))?;

            if meta.is_file() {
                let full = entry.path();
                let rel = full
                    .strip_prefix(&self.base_path)
                    .unwrap_or(&full)
                    .to_string_lossy()
                    .replace('\\', "/");
                results.push(StorageObject {
                    key: rel,
                    size: meta.len(),
                });
            }
        }

        Ok(results)
    }
}
