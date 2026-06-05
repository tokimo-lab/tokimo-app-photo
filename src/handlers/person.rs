//! Person / face handlers.

use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, Query, State},
};
use serde::Deserialize;

use crate::ctx::AppCtx;
use crate::db::{pagination::PageInput, repos::photo_repo::PhotoRepo};
use crate::error::AppError;

use super::{ok, ok_simple, parse_uuid};

// ── List persons ──────────────────────────────────────────────────────────────

pub async fn list_persons(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let app_id = parse_uuid(&id)?;
    let persons = PhotoRepo::list_persons(&ctx.db, app_id).await?;
    ok(persons)
}

// ── Person photos ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonPhotosQuery {
    pub page: Option<u64>,
    pub page_size: Option<u64>,
}

pub async fn person_photos(
    State(ctx): State<Arc<AppCtx>>,
    Path((_lib_id, person_id)): Path<(String, String)>,
    Query(q): Query<PersonPhotosQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let pid = parse_uuid(&person_id)?;
    let page = PageInput {
        page: q.page.unwrap_or(1),
        page_size: q.page_size.unwrap_or(80),
    };
    let result = PhotoRepo::list_photos_by_person(&ctx.db, pid, &page).await?;
    ok(result)
}

// ── Merge persons ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergePersonsBody {
    pub target_id: String,
    pub source_id: String,
}

pub async fn merge_persons(
    State(ctx): State<Arc<AppCtx>>,
    Path(_id): Path<String>,
    Json(body): Json<MergePersonsBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    let target_id = parse_uuid(&body.target_id)?;
    let source_id = parse_uuid(&body.source_id)?;
    PhotoRepo::merge_persons(&ctx.db, target_id, source_id).await?;
    ok_simple()
}

// ── Rename person ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct RenamePersonBody {
    pub name: String,
}

pub async fn rename_person(
    State(ctx): State<Arc<AppCtx>>,
    Path((_lib_id, person_id)): Path<(String, String)>,
    Json(body): Json<RenamePersonBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    let pid = parse_uuid(&person_id)?;
    PhotoRepo::rename_person(&ctx.db, pid, &body.name).await?;
    ok_simple()
}
