//! Unified error types for the photo app.

use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Serialize;

/// Unified application error.
#[derive(Debug)]
pub enum AppError {
    BadRequest(String),
    Unauthorized(String),
    Forbidden(String),
    NotFound(String),
    Conflict(String),
    Internal(String),
}

impl AppError {
    pub fn bad_request(msg: impl Into<String>) -> Self {
        Self::BadRequest(msg.into())
    }
    pub fn internal(msg: impl Into<String>) -> Self {
        Self::Internal(msg.into())
    }
    pub fn not_found(msg: impl Into<String>) -> Self {
        Self::NotFound(msg.into())
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::BadRequest(m) => write!(f, "BadRequest: {m}"),
            Self::Unauthorized(m) => write!(f, "Unauthorized: {m}"),
            Self::Forbidden(m) => write!(f, "Forbidden: {m}"),
            Self::NotFound(m) => write!(f, "NotFound: {m}"),
            Self::Conflict(m) => write!(f, "Conflict: {m}"),
            Self::Internal(m) => write!(f, "InternalError: {m}"),
        }
    }
}

impl std::error::Error for AppError {}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            Self::BadRequest(m) => (StatusCode::BAD_REQUEST, m.clone()),
            Self::Unauthorized(m) => (StatusCode::UNAUTHORIZED, m.clone()),
            Self::Forbidden(m) => (StatusCode::FORBIDDEN, m.clone()),
            Self::NotFound(m) => (StatusCode::NOT_FOUND, m.clone()),
            Self::Conflict(m) => (StatusCode::CONFLICT, m.clone()),
            Self::Internal(m) => (StatusCode::INTERNAL_SERVER_ERROR, m.clone()),
        };
        let body = serde_json::json!({ "error": message });
        (status, Json(body)).into_response()
    }
}

impl From<sea_orm::DbErr> for AppError {
    fn from(e: sea_orm::DbErr) -> Self {
        Self::Internal(format!("db: {e}"))
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        Self::Internal(format!("json: {e}"))
    }
}

/// Extension trait for `Option<T>` to convert `None` into `AppError::NotFound`.
pub trait OptionExt<T> {
    fn not_found(self, msg: impl Into<String>) -> Result<T, AppError>;
    fn bad_request(self, msg: impl Into<String>) -> Result<T, AppError>;
}

impl<T> OptionExt<T> for Option<T> {
    fn not_found(self, msg: impl Into<String>) -> Result<T, AppError> {
        self.ok_or_else(|| AppError::NotFound(msg.into()))
    }
    fn bad_request(self, msg: impl Into<String>) -> Result<T, AppError> {
        self.ok_or_else(|| AppError::BadRequest(msg.into()))
    }
}

// ── API Response helpers ──

#[derive(Debug, Serialize)]
pub struct ApiResponse<T: Serialize> {
    pub data: T,
}

#[derive(Debug, Serialize)]
pub struct EmptyResponse {
    pub ok: bool,
}

pub fn ok<T: Serialize>(data: T) -> Json<ApiResponse<T>> {
    Json(ApiResponse { data })
}

pub fn ok_empty() -> Json<EmptyResponse> {
    Json(EmptyResponse { ok: true })
}

pub fn err404<T>(msg: String) -> Json<serde_json::Value> {
    Json(serde_json::json!({ "error": msg }))
}

pub fn err500<T>(msg: String) -> Json<serde_json::Value> {
    Json(serde_json::json!({ "error": msg }))
}
