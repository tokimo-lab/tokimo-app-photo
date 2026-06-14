use serde::Serialize;
use serde_json::Value;
use ts_rs::TS;

/// Internal record used by `SourceRegistry` for driver management.
#[derive(Debug, Clone)]
pub struct VfsRecord {
    pub id: String,
    pub vfs_type: String,
    pub config: Value,
}

/// Public status view of a connected file system driver.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct VfsStatus {
    pub id: String,
    #[ts(type = "string")]
    pub r#type: String,
    pub driver: String,
    pub state: String,
    pub error: Option<String>,
}
