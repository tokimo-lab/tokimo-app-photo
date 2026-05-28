//! HTTP handler entrypoints — one module per domain.

pub mod ai;
pub mod album;
pub mod batch;
pub mod browse;
pub mod crud;
pub mod geo;
pub mod person;
pub mod stream;
pub mod sync;

pub use ai::*;
pub use album::*;
pub use batch::*;
pub use browse::*;
pub use crud::*;
pub use geo::*;
pub use person::*;
pub use stream::*;
pub use sync::*;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

use axum::Json;
use serde::Serialize;
use uuid::Uuid;

use crate::error::AppError;

pub fn ok<T: Serialize>(data: T) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(serde_json::json!({ "success": true, "data": data })))
}

pub fn ok_simple() -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(serde_json::json!({ "success": true })))
}

pub fn parse_uuid(s: &str) -> Result<Uuid, AppError> {
    Uuid::parse_str(s).map_err(|_| AppError::BadRequest(format!("invalid UUID: {s}")))
}
