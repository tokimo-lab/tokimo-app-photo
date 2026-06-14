//! Cross-storage file transfer engine.
//!
//! TODO: Port full implementation from monorepo when `tokimo-package-ssh`
//! crate is added to Cargo.toml.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferFileEntry {
    pub src_path: String,
    pub dst_path: String,
    #[serde(default)]
    pub size: u64,
    #[serde(default)]
    pub is_directory: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TransferStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TransferEndpoint {
    #[serde(rename_all = "camelCase")]
    FileSystem { id: String },
    #[serde(rename_all = "camelCase")]
    SshTerminal { id: String },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgress {
    pub transfer_id: String,
    pub status: TransferStatus,
    pub total_bytes: u64,
    pub transferred_bytes: u64,
    pub speed_bps: u64,
    pub current_file: String,
    pub current_file_index: usize,
    pub total_files: usize,
    pub elapsed_secs: f64,
    pub eta_secs: f64,
    pub error: Option<String>,
    pub src_label: String,
    pub dst_label: String,
    pub is_direct: bool,
    pub uploading: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTransferRequest {
    pub src: TransferEndpoint,
    pub dst: TransferEndpoint,
    pub src_label: String,
    pub dst_label: String,
    pub files: Vec<TransferFileEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTransferResponse {
    pub transfer_id: String,
    pub total_bytes: u64,
    pub total_files: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelTransferRequest {
    pub transfer_id: String,
}
