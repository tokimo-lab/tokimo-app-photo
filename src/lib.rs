//! Library facade — exposes modules for ts-rs type generation and testing.

use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};

/// Compile-time embedded app manifest, used by the db module to read the schema name.
pub(crate) const MANIFEST: &str = include_str!("../tokimo-app.toml");

pub mod bus_clients;
pub mod db;
pub mod handlers;

/// 统一错误响应。
pub struct AppError {
    pub status: StatusCode,
    pub message: String,
}

impl AppError {
    pub fn bad_request(msg: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: msg.into(),
        }
    }
    pub fn internal(msg: impl Into<String>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: msg.into(),
        }
    }
    pub fn not_found(msg: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message: msg.into(),
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let body = serde_json::json!({ "error": self.message });
        (self.status, Json(body)).into_response()
    }
}

impl From<sea_orm::DbErr> for AppError {
    fn from(e: sea_orm::DbErr) -> Self {
        Self::internal(format!("db: {e}"))
    }
}
