use reqwest::Client;
use tokimo_package_client_api::geocoding::{GeoLocation, GeocodingClient};
use sea_orm::sea_query::OnConflict;
use sea_orm::*;
use serde::{Deserialize, Serialize};
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::config::PhotoGeoSettings;
use crate::db::entities::{photo_geo_cache, photos};
use crate::db::repos::system_config_repo::SystemConfigRepo;
use crate::error::AppError;
use crate::error::OptionExt;

/// Round coordinate to ~10m precision for cache key deduplication.
fn coord_cache_key(val: f64) -> String {
    format!("{val:.4}")
}

/// Check whether the selected provider has its required key configured.
fn provider_has_key(settings: &PhotoGeoSettings) -> bool {
    match settings.provider.as_str() {
        "amap" => settings.amap_api_key.as_ref().is_some_and(|k| !k.is_empty()),
        "qqmap" => settings.qqmap_api_key.as_ref().is_some_and(|k| !k.is_empty()),
        "tianditu" => settings.tianditu_server_key.as_ref().is_some_and(|k| !k.is_empty()),
        "mapbox" => settings.mapbox_access_token.as_ref().is_some_and(|k| !k.is_empty()),
        "maptiler" => settings.maptiler_api_key.as_ref().is_some_and(|k| !k.is_empty()),
        _ => false,
    }
}

/// Dispatch a reverse-geocode call to the configured provider.
pub async fn reverse_geocode_dispatch(
    http: &Client,
    settings: &PhotoGeoSettings,
    lon: f64,
    lat: f64,
) -> Result<GeoLocation, AppError> {
    let geo_client = GeocodingClient::new(http.clone());
    match settings.provider.as_str() {
        "amap" => {
            let key = settings
                .amap_api_key
                .as_deref()
                .internal("Amap API key not configured")?;
            let secret = settings.amap_secret.as_deref();
            geo_client
                .amap_reverse_geocode(key, secret, lon, lat)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))
        }
        "qqmap" => {
            let key = settings
                .qqmap_api_key
                .as_deref()
                .internal("QQ Map API key not configured")?;
            let secret = settings.qqmap_secret_key.as_deref();
            geo_client
                .qqmap_reverse_geocode(key, secret, lon, lat)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))
        }
        "tianditu" => {
            let key = settings
                .tianditu_server_key
                .as_deref()
                .internal("Tianditu server key not configured")?;
            geo_client
                .tianditu_reverse_geocode(key, lon, lat)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))
        }
        "mapbox" => {
            let token = settings
                .mapbox_access_token
                .as_deref()
                .internal("Mapbox access token not configured")?;
            geo_client
                .mapbox_reverse_geocode(token, lon, lat)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))
        }
        "maptiler" => {
            let key = settings
                .maptiler_api_key
                .as_deref()
                .internal("MapTiler API key not configured")?;
            geo_client
                .maptiler_reverse_geocode(key, lon, lat)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))
        }
        other => Err(AppError::Internal(format!("Unknown geo provider: {other}"))),
    }
}

// ── PhotoGeoService ──────────────────────────────────────────────────────────

pub struct PhotoGeoService;

impl PhotoGeoService {
    /// Look up cache first, then call API if miss. Stores result in cache.
    async fn resolve_location(
        db: &DatabaseConnection,
        http: &Client,
        settings: &PhotoGeoSettings,
        lat: f64,
        lon: f64,
    ) -> Result<GeoLocation, AppError> {
        let lat_key = coord_cache_key(lat);
        let lon_key = coord_cache_key(lon);

        // Check cache
        if let Some(cached) = photo_geo_cache::Entity::find()
            .filter(photo_geo_cache::Column::LatKey.eq(&lat_key))
            .filter(photo_geo_cache::Column::LonKey.eq(&lon_key))
            .one(db)
            .await?
        {
            return Ok(GeoLocation {
                province: cached.province,
                city: cached.city,
                district: cached.district,
                township: cached.township,
                adcode: cached.adcode,
                address: cached.address,
                country: cached.country,
            });
        }

        // Call the configured provider
        let geo = reverse_geocode_dispatch(http, settings, lon, lat).await?;

        // Store in cache
        let cache_model = photo_geo_cache::ActiveModel {
            lat_key: Set(lat_key),
            lon_key: Set(lon_key),
            province: Set(geo.province.clone()),
            city: Set(geo.city.clone()),
            district: Set(geo.district.clone()),
            township: Set(geo.township.clone()),
            adcode: Set(geo.adcode.clone()),
            address: Set(geo.address.clone()),
            country: Set(geo.country.clone()),
            ..Default::default()
        };
        photo_geo_cache::Entity::insert(cache_model)
            .on_conflict(
                OnConflict::columns([photo_geo_cache::Column::LatKey, photo_geo_cache::Column::LonKey])
                    .do_nothing()
                    .to_owned(),
            )
            .exec(db)
            .await
            .ok(); // ignore duplicate insert races

        Ok(geo)
    }

    /// Batch reverse-geocode all photos in an app that have GPS but no geo data.
    pub async fn reverse_geocode_app(db: &DatabaseConnection, http: &Client, app_id: Uuid) -> Result<u32, AppError> {
        let pending = Self::list_pending_photo_ids(db, app_id).await?;
        if pending.is_empty() {
            return Ok(0);
        }
        let total = pending.len();
        info!("Reverse geocoding {total} photos for app {app_id}");
        let (success, _, _) = Self::process_photo_ids(db, http, pending).await;
        info!("Reverse geocoding done: {success}/{total} photos updated");
        Ok(success)
    }

    /// List photo IDs missing geo data (have GPS but no province).
    pub async fn list_pending_photo_ids(db: &DatabaseConnection, app_id: Uuid) -> Result<Vec<Uuid>, AppError> {
        let settings: PhotoGeoSettings = SystemConfigRepo::get(db).await?;
        if !settings.enabled || !provider_has_key(&settings) {
            return Err(AppError::Internal(
                "Reverse geocoding not enabled or API key missing".into(),
            ));
        }
        let ids = photos::Entity::find()
            .filter(photos::Column::AppId.eq(app_id))
            .filter(photos::Column::GpsLatitude.is_not_null())
            .filter(photos::Column::GpsLongitude.is_not_null())
            .filter(photos::Column::GeoProvince.is_null())
            .filter(photos::Column::DeletedAt.is_null())
            .select_only()
            .column(photos::Column::Id)
            .into_tuple::<Uuid>()
            .all(db)
            .await?;
        Ok(ids)
    }

    /// Process explicit photo IDs (used by child batch jobs). Lenient: per-photo
    /// failures don't abort the batch.
    pub async fn process_photo_ids(db: &DatabaseConnection, http: &Client, ids: Vec<Uuid>) -> (u32, u32, Vec<String>) {
        let mut errors: Vec<String> = Vec::new();
        let settings: PhotoGeoSettings = match SystemConfigRepo::get(db).await {
            Ok(s) => s,
            Err(e) => {
                let msg = format!("failed to load settings: {e}");
                error!("[photo_geo] {msg}");
                errors.push(msg);
                return (0, ids.len() as u32, errors);
            }
        };
        let mut success_count = 0u32;
        let mut failure_count = 0u32;

        for photo_id in ids {
            let Ok(Some(photo)) = photos::Entity::find_by_id(photo_id).one(db).await else {
                failure_count += 1;
                errors.push(format!("photo {photo_id} not found"));
                continue;
            };
            let Some(lat) = photo.gps_latitude else {
                continue;
            };
            let Some(lon) = photo.gps_longitude else {
                continue;
            };

            match Self::resolve_location(db, http, &settings, lat, lon).await {
                Ok(geo) => {
                    let loc_name = [
                        geo.province.as_deref(),
                        geo.city.as_deref(),
                        geo.district.as_deref(),
                        geo.township.as_deref(),
                    ]
                    .iter()
                    .filter_map(|s| *s)
                    .collect::<Vec<_>>()
                    .join("");

                    let mut active: photos::ActiveModel = photo.clone().into();
                    active.geo_province = Set(geo.province);
                    active.geo_city = Set(geo.city);
                    active.geo_district = Set(geo.district);
                    active.geo_township = Set(geo.township);
                    active.geo_adcode = Set(geo.adcode);
                    active.geo_address = Set(geo.address);
                    if !loc_name.is_empty() {
                        active.location_name = Set(Some(loc_name));
                    }
                    if let Err(e) = active.update(db).await {
                        let msg = format!("Failed to update photo {photo_id} geo: {e}");
                        error!("{msg}");
                        errors.push(msg);
                        failure_count += 1;
                    } else {
                        success_count += 1;
                    }
                }
                Err(e) => {
                    failure_count += 1;
                    let msg = format!("Geocode failed for photo {photo_id} ({lat},{lon}): {e}");
                    warn!("{msg}");
                    errors.push(msg);
                    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                }
            }

            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        }

        (success_count, failure_count, errors)
    }

    /// Get location stats for an app (grouped by province/city/district).
    pub async fn location_stats(db: &DatabaseConnection, app_id: Uuid) -> Result<Vec<LocationGroup>, AppError> {
        use sea_orm::{ConnectionTrait, DatabaseBackend, Statement};

        let rows = db
            .query_all_raw(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r"
                SELECT
                    geo_province,
                    geo_city,
                    geo_district,
                    COUNT(*) as photo_count
                FROM photos
                WHERE app_id = $1
                  AND geo_province IS NOT NULL
                  AND deleted_at IS NULL
                GROUP BY geo_province, geo_city, geo_district
                ORDER BY photo_count DESC
                ",
                [app_id.into()],
            ))
            .await?;

        let mut groups = Vec::new();
        for row in rows {
            groups.push(LocationGroup {
                province: row.try_get("", "geo_province").ok(),
                city: row.try_get("", "geo_city").ok(),
                district: row.try_get("", "geo_district").ok(),
                photo_count: row.try_get::<i64>("", "photo_count").unwrap_or(0),
            });
        }
        Ok(groups)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocationGroup {
    pub province: Option<String>,
    pub city: Option<String>,
    pub district: Option<String>,
    pub photo_count: i64,
}
