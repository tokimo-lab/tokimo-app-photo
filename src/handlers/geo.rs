use axum::{
    Json,
    extract::{Path, Query, State},
    response::IntoResponse,
};
use serde::Deserialize;
use std::sync::Arc;

use crate::AppState;
use crate::repos::{PhotoLibraryRepo, PhotoRepo};
use crate::db::pagination::PageInput;
use crate::error::{AppError, OptionExt};
use crate::handlers::user::AuthUser;
use crate::handlers::{ApiResponse, ok};

use super::parse_uuid;

/// POST /api/apps/photo/{id}/photos/reverse-geocode
pub async fn reverse_geocode(
    State(state): State<Arc<AppState>>,
    AuthUser(auth): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let app_id = parse_uuid(&id)?;
    let user_id: uuid::Uuid = auth
        .user_id
        .parse()
        .map_err(|_| AppError::Unauthorized("invalid auth user id".into()))?;
    PhotoLibraryRepo::get_by_id(&state.db, app_id)
        .await?
        .not_found(format!("photo library {id} not found"))?;

    crate::services::preempt::preempt_scan_for(&state, app_id, "photo_geocode_scan").await?;

    crate::db::repos::job_repo::JobRepo::create_job(
        &state.db,
        "photo_geocode_scan",
        serde_json::json!({ "photoLibraryId": app_id.to_string() }),
        None,
        Some(user_id),
    )
    .await?;
    Ok(ok(serde_json::json!({"status": "started"})))
}

/// GET /api/apps/photo/{id}/photos/map-points
pub async fn map_points(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let app_id = parse_uuid(&id)?;
    let points = PhotoRepo::list_map_points(&state.db, app_id).await?;
    Ok(ok(serde_json::to_value(points).unwrap()))
}

/// GET /api/apps/photo/{id}/photos/locations
pub async fn location_stats(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    use crate::services::geo::PhotoGeoService;

    let app_id = parse_uuid(&id)?;
    let groups = PhotoGeoService::location_stats(&state.db, app_id).await?;
    Ok(ok(serde_json::to_value(groups).unwrap()))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocationQuery {
    pub page: Option<u64>,
    pub page_size: Option<u64>,
    pub province: Option<String>,
    pub city: Option<String>,
    pub district: Option<String>,
}

/// GET /api/apps/photo/{id}/photos/by-location
pub async fn photos_by_location(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(q): Query<LocationQuery>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let app_id = parse_uuid(&id)?;
    let page = PageInput {
        page: q.page.unwrap_or(1),
        page_size: q.page_size.unwrap_or(80),
    };
    let photos = PhotoRepo::list_by_location(
        &state.db,
        app_id,
        &page,
        q.province.as_deref(),
        q.city.as_deref(),
        q.district.as_deref(),
    )
    .await?;
    Ok(ok(serde_json::to_value(photos).unwrap()))
}

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

/// GET /api/apps/photo/{id}/photos/by-bbox
pub async fn photos_by_bbox(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(q): Query<BboxQuery>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let app_id = parse_uuid(&id)?;
    let page = PageInput {
        page: q.page.unwrap_or(1),
        page_size: q.page_size.unwrap_or(80),
    };
    let photos = PhotoRepo::list_by_bbox(&state.db, app_id, q.min_lat, q.max_lat, q.min_lng, q.max_lng, &page).await?;
    Ok(ok(serde_json::to_value(photos).unwrap()))
}

// ── Photo Geo Settings ──

/// GET /api/settings/photo-geo
pub async fn get_photo_geo_settings(
    State(state): State<Arc<AppState>>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    use crate::config::PhotoGeoSettings;
    use crate::db::repos::system_config_repo::SystemConfigRepo;
    let settings: PhotoGeoSettings = SystemConfigRepo::get(&state.db).await?;
    Ok(ok(serde_json::to_value(settings).unwrap()))
}

/// PUT /api/settings/photo-geo
pub async fn update_photo_geo_settings(
    State(state): State<Arc<AppState>>,
    Json(body): Json<crate::config::PhotoGeoSettings>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    use crate::db::repos::system_config_repo::SystemConfigRepo;
    SystemConfigRepo::set(&state.db, &body).await?;
    Ok(ok(serde_json::to_value(body).unwrap()))
}

/// POST /api/settings/photo-geo/test
pub async fn test_photo_geo_connection(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    use crate::services::geo::reverse_geocode_dispatch;
    use crate::config::PhotoGeoSettings;
    use crate::db::repos::system_config_repo::SystemConfigRepo;

    let settings: PhotoGeoSettings = match SystemConfigRepo::get(&state.db).await {
        Ok(s) => s,
        Err(e) => return e.into_response(),
    };

    let mut results: Vec<serde_json::Value> = Vec::new();
    let http = &state.http_client;

    let test_lon = 116.397_428;
    let test_lat = 39.90923;

    let api_result = match reverse_geocode_dispatch(http, &settings, test_lon, test_lat).await {
        Ok(geo) => {
            let addr = geo
                .address
                .or_else(|| {
                    let parts: Vec<&str> = [
                        geo.country.as_deref(),
                        geo.province.as_deref(),
                        geo.city.as_deref(),
                        geo.district.as_deref(),
                    ]
                    .into_iter()
                    .flatten()
                    .collect();
                    if parts.is_empty() { None } else { Some(parts.join("")) }
                })
                .unwrap_or_else(|| "OK".to_string());
            serde_json::json!({ "name": "serverApi", "success": true, "detail": addr })
        }
        Err(e) => {
            serde_json::json!({ "name": "serverApi", "success": false, "detail": e.to_string() })
        }
    };
    results.push(api_result);

    match settings.provider.as_str() {
        "amap" => {
            if let Some(js_key) = settings.amap_js_api_key.as_deref().filter(|k| !k.is_empty()) {
                let map_result = test_amap_js_key(http, js_key).await;
                results.push(map_result);
            }
        }
        "tianditu" => {
            if let Some(bk) = settings.tianditu_browser_key.as_deref().filter(|k| !k.is_empty()) {
                let map_result = test_tianditu_browser_key(http, bk).await;
                results.push(map_result);
            }
        }
        _ => {}
    }

    ok(serde_json::json!({ "results": results })).into_response()
}

async fn test_amap_js_key(http: &reqwest::Client, js_key: &str) -> serde_json::Value {
    let url = format!("https://vdata.amap.com/nebula/v2?key={js_key}&flds=road,building,region&t=10,855,340,0&p=16");
    match http.get(&url).send().await {
        Ok(resp) => {
            if resp.status().is_success() {
                serde_json::json!({ "name": "mapKey", "success": true, "detail": "OK" })
            } else {
                let detail = format!("HTTP {}", resp.status());
                serde_json::json!({ "name": "mapKey", "success": false, "detail": detail })
            }
        }
        Err(e) => {
            serde_json::json!({ "name": "mapKey", "success": false, "detail": e.to_string() })
        }
    }
}

async fn test_tianditu_browser_key(http: &reqwest::Client, tk: &str) -> serde_json::Value {
    let url = format!(
        "http://t0.tianditu.gov.cn/vec_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=vec&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILECOL=0&TILEROW=0&TILEMATRIX=1&tk={tk}"
    );
    match http.get(&url).send().await {
        Ok(resp) => {
            if resp.status().is_success() {
                serde_json::json!({ "name": "mapKey", "success": true, "detail": "OK" })
            } else {
                let detail = format!("HTTP {}", resp.status());
                serde_json::json!({ "name": "mapKey", "success": false, "detail": detail })
            }
        }
        Err(e) => {
            serde_json::json!({ "name": "mapKey", "success": false, "detail": e.to_string() })
        }
    }
}
