//! Geo handlers — map points, location stats, reverse geocode, bbox.

use std::sync::Arc;

use axum::{Json, extract::{Path, Query, State}};
use serde::Deserialize;

use crate::ctx::AppCtx;
use crate::db::{pagination::PageInput, repos::photo_repo::PhotoRepo};
use crate::error::AppError;

use super::{ok, ok_simple, parse_uuid};

// ── Reverse geocode ──────────────────────────────────────────────────────────

pub async fn reverse_geocode(
    State(_ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let app_id = parse_uuid(&id)?;
    let _ = app_id;
    tracing::warn!("reverse_geocode: geo service not available in sidecar");
    ok_simple()
}

// ── Map points ───────────────────────────────────────────────────────────────

pub async fn map_points(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let app_id = parse_uuid(&id)?;
    let points = PhotoRepo::list_map_points(&ctx.db, app_id).await?;
    ok(points)
}

// ── Location stats ───────────────────────────────────────────────────────────

pub async fn location_stats(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let app_id = parse_uuid(&id)?;
    let stats = PhotoRepo::location_stats(&ctx.db, app_id).await?;
    ok(stats)
}

// ── Photos by location ───────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocationQuery {
    pub page: Option<u64>,
    pub page_size: Option<u64>,
    pub province: Option<String>,
    pub city: Option<String>,
    pub district: Option<String>,
}

pub async fn photos_by_location(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Query(q): Query<LocationQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let app_id = parse_uuid(&id)?;
    let page = PageInput {
        page: q.page.unwrap_or(1),
        page_size: q.page_size.unwrap_or(80),
    };
    let result = PhotoRepo::list_by_location(
        &ctx.db,
        app_id,
        &page,
        q.province.as_deref(),
        q.city.as_deref(),
        q.district.as_deref(),
    )
    .await?;
    ok(result)
}

// ── Photos by bbox ───────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BboxQuery {
    pub min_lat: f64,
    pub max_lat: f64,
    pub min_lng: f64,
    pub max_lng: f64,
    pub page: Option<u64>,
    pub page_size: Option<u64>,
}

pub async fn photos_by_bbox(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Query(q): Query<BboxQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let app_id = parse_uuid(&id)?;
    let page = PageInput {
        page: q.page.unwrap_or(1),
        page_size: q.page_size.unwrap_or(80),
    };
    let result = PhotoRepo::list_by_bbox(
        &ctx.db,
        app_id,
        q.min_lat,
        q.max_lat,
        q.min_lng,
        q.max_lng,
        &page,
    )
    .await?;
    ok(result)
}
