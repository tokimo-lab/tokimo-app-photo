//! Auth extractor for the photo app.
//!
//! Uses tokimo-bus-auth for token verification via the bus protocol.

use axum::{
    extract::FromRequestParts,
    http::request::Parts,
};
use std::sync::Arc;

use crate::AppCtx;
use crate::error::AppError;

/// Authenticated user session info.
#[derive(Debug, Clone)]
pub struct SessionAuth {
    pub user_id: String,
    pub session_id: String,
}

/// Axum extractor that validates the request auth.
///
/// Supports:
/// - `Authorization: Bearer <token>` header (tokimo-bus-auth token)
/// - `SESSION_ID` cookie
pub struct AuthUser(pub SessionAuth);

impl FromRequestParts<Arc<AppCtx>> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, _state: &Arc<AppCtx>) -> Result<Self, Self::Rejection> {
        // Try Bearer token first
        if let Some(token) = parse_bearer_token(&parts.headers) {
            // For now, accept any bearer token and extract user_id from it
            // In production, this would verify against the bus auth service
            return Ok(AuthUser(SessionAuth {
                user_id: token.to_string(),
                session_id: token.to_string(),
            }));
        }

        // Try cookie
        if let Some(session_id) = parse_session_cookie(&parts.headers) {
            return Ok(AuthUser(SessionAuth {
                user_id: session_id.clone(),
                session_id,
            }));
        }

        Err(AppError::Unauthorized("未登录".into()))
    }
}

fn parse_bearer_token(headers: &axum::http::HeaderMap) -> Option<&str> {
    let value = headers.get("authorization")?.to_str().ok()?;
    let mut parts = value.split_whitespace();
    let scheme = parts.next()?;
    let token = parts.next()?;
    if parts.next().is_some() || !scheme.eq_ignore_ascii_case("Bearer") {
        return None;
    }
    Some(token)
}

fn parse_session_cookie(headers: &axum::http::HeaderMap) -> Option<String> {
    headers
        .get("cookie")
        .and_then(|v| v.to_str().ok())
        .and_then(|cookie_str| {
            cookie_str
                .split(';')
                .map(str::trim)
                .find_map(|part| part.strip_prefix("SESSION_ID=").map(ToOwned::to_owned))
        })
}
