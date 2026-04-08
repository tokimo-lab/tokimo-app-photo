use md5::Digest as _;
use std::fmt::Write as _;
use reqwest::Client;
use sea_orm::sea_query::OnConflict;
use sea_orm::*;
use serde::{Deserialize, Serialize};
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::db::entities::{photo_geo_cache, photos};
use crate::config::PhotoGeoSettings;
use crate::db::repos::system_config_repo::SystemConfigRepo;
use crate::error::AppError;
use crate::error::OptionExt;

/// Reverse-geocoded location data.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeoLocation {
    pub province: Option<String>,
    pub city: Option<String>,
    pub district: Option<String>,
    pub township: Option<String>,
    pub adcode: Option<String>,
    pub address: Option<String>,
    pub country: Option<String>,
}

/// Round coordinate to ~10m precision for cache key deduplication.
fn coord_cache_key(val: f64) -> String {
    format!("{val:.4}")
}

/// Check whether the selected provider has its required key configured.
fn provider_has_key(settings: &PhotoGeoSettings) -> bool {
    match settings.provider.as_str() {
        "amap" => settings.amap_api_key.as_ref().is_some_and(|k| !k.is_empty()),
        "qqmap" => settings.qqmap_api_key.as_ref().is_some_and(|k| !k.is_empty()),
        "tianditu" => settings
            .tianditu_server_key
            .as_ref()
            .is_some_and(|k| !k.is_empty()),
        "mapbox" => settings
            .mapbox_access_token
            .as_ref()
            .is_some_and(|k| !k.is_empty()),
        "maptiler" => settings
            .maptiler_api_key
            .as_ref()
            .is_some_and(|k| !k.is_empty()),
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
    match settings.provider.as_str() {
        "amap" => {
            let key = settings
                .amap_api_key
                .as_deref()
                .internal("Amap API key not configured")?;
            let secret = settings.amap_secret.as_deref();
            amap_reverse_geocode(http, key, secret, lon, lat).await
        }
        "qqmap" => {
            let key = settings
                .qqmap_api_key
                .as_deref()
                .internal("QQ Map API key not configured")?;
            let secret = settings.qqmap_secret_key.as_deref();
            qqmap_reverse_geocode(http, key, secret, lon, lat).await
        }
        "tianditu" => {
            let key = settings
                .tianditu_server_key
                .as_deref()
                .internal("Tianditu server key not configured")?;
            tianditu_reverse_geocode(http, key, lon, lat).await
        }
        "mapbox" => {
            let token = settings
                .mapbox_access_token
                .as_deref()
                .internal("Mapbox access token not configured")?;
            mapbox_reverse_geocode(http, token, lon, lat).await
        }
        "maptiler" => {
            let key = settings
                .maptiler_api_key
                .as_deref()
                .internal("MapTiler API key not configured")?;
            maptiler_reverse_geocode(http, key, lon, lat).await
        }
        other => Err(AppError::Internal(format!(
            "Unknown geo provider: {other}"
        ))),
    }
}

// ── Amap (高德) reverse geocoding ────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct AmapResponse {
    status: String,
    info: Option<String>,
    regeocode: Option<AmapRegeocode>,
}

#[derive(Debug, Deserialize)]
struct AmapRegeocode {
    formatted_address: Option<AmapStrOrEmpty>,
    #[serde(rename = "addressComponent")]
    address_component: Option<AmapAddressComponent>,
}

/// Amap sometimes returns "" or [] for empty fields — handle both.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum AmapStrOrEmpty {
    Str(String),
    #[allow(dead_code)]
    List(Vec<serde_json::Value>),
}

impl AmapStrOrEmpty {
    fn as_opt_string(&self) -> Option<String> {
        match self {
            AmapStrOrEmpty::Str(s) if !s.is_empty() => Some(s.clone()),
            _ => None,
        }
    }
}

#[derive(Debug, Deserialize)]
struct AmapAddressComponent {
    province: Option<AmapStrOrEmpty>,
    city: Option<AmapStrOrEmpty>,
    district: Option<AmapStrOrEmpty>,
    township: Option<AmapStrOrEmpty>,
    adcode: Option<AmapStrOrEmpty>,
    country: Option<AmapStrOrEmpty>,
}

async fn amap_reverse_geocode(
    http: &Client,
    api_key: &str,
    secret: Option<&str>,
    lon: f64,
    lat: f64,
) -> Result<GeoLocation, AppError> {
    let location = format!("{lon:.6},{lat:.6}");
    let mut url = format!(
        "https://restapi.amap.com/v3/geocode/regeo?key={api_key}&location={location}&extensions=base"
    );

    // When secret is configured, compute digital signature
    // Algorithm: sort params alphabetically, concat as k1=v1&k2=v2, append secret, md5
    if let Some(sec) = secret
        && !sec.is_empty() {
            let mut params = [("extensions", "base".to_string()),
                ("key", api_key.to_string()),
                ("location", location.clone())];
            params.sort_by(|a, b| a.0.cmp(b.0));
            let sign_str: String = params
                .iter()
                .map(|(k, v)| format!("{k}={v}"))
                .collect::<Vec<_>>()
                .join("&");
            let sig = hex::encode(md5::Md5::digest(format!("{sign_str}{sec}").as_bytes()));
            write!(url, "&sig={sig}").ok();
        }

    let resp: AmapResponse = http
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Amap HTTP error: {e}")))?
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("Amap JSON parse error: {e}")))?;

    if resp.status != "1" {
        let info = resp.info.unwrap_or_default();
        return Err(AppError::Internal(format!("Amap API error: {info}")));
    }

    let regeo = resp
        .regeocode
        .internal("Amap: no regeocode in response")?;

    let comp = regeo.address_component;
    Ok(GeoLocation {
        province: comp
            .as_ref()
            .and_then(|c| c.province.as_ref()?.as_opt_string()),
        city: comp
            .as_ref()
            .and_then(|c| c.city.as_ref()?.as_opt_string()),
        district: comp
            .as_ref()
            .and_then(|c| c.district.as_ref()?.as_opt_string()),
        township: comp
            .as_ref()
            .and_then(|c| c.township.as_ref()?.as_opt_string()),
        adcode: comp
            .as_ref()
            .and_then(|c| c.adcode.as_ref()?.as_opt_string()),
        address: regeo
            .formatted_address
            .as_ref()
            .and_then(AmapStrOrEmpty::as_opt_string),
        country: comp
            .as_ref()
            .and_then(|c| c.country.as_ref()?.as_opt_string()),
    })
}

// ── QQ Map (腾讯) reverse geocoding ─────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct QqmapResponse {
    status: i32,
    message: Option<String>,
    result: Option<QqmapResult>,
}

#[derive(Debug, Deserialize)]
struct QqmapResult {
    address: Option<String>,
    address_component: Option<QqmapAddressComponent>,
    ad_info: Option<QqmapAdInfo>,
}

#[derive(Debug, Deserialize)]
struct QqmapAddressComponent {
    nation: Option<String>,
    province: Option<String>,
    city: Option<String>,
    district: Option<String>,
}

#[derive(Debug, Deserialize)]
struct QqmapAdInfo {
    adcode: Option<String>,
}

async fn qqmap_reverse_geocode(
    http: &Client,
    api_key: &str,
    secret_key: Option<&str>,
    lon: f64,
    lat: f64,
) -> Result<GeoLocation, AppError> {
    let location = format!("{lat:.6},{lon:.6}");
    let url = if let Some(secret) = secret_key {
        // Compute MD5 signature: md5("/ws/geocoder/v1/?key={key}&location={lat},{lng}{secret}")
        let sign_str = format!(
            "/ws/geocoder/v1/?key={api_key}&location={location}{secret}"
        );
        let sig = hex::encode(md5::Md5::digest(sign_str.as_bytes()));
        format!(
            "https://apis.map.qq.com/ws/geocoder/v1/?key={api_key}&location={location}&sig={sig}"
        )
    } else {
        format!("https://apis.map.qq.com/ws/geocoder/v1/?key={api_key}&location={location}")
    };

    let resp: QqmapResponse = http
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("QQ Map HTTP error: {e}")))?
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("QQ Map JSON parse error: {e}")))?;

    if resp.status != 0 {
        let msg = resp.message.unwrap_or_default();
        return Err(AppError::Internal(format!("QQ Map API error: {msg}")));
    }

    let result = resp
        .result
        .internal("QQ Map: no result in response")?;

    let comp = result.address_component.as_ref();
    Ok(GeoLocation {
        province: comp.and_then(|c| c.province.clone()).filter(|s| !s.is_empty()),
        city: comp.and_then(|c| c.city.clone()).filter(|s| !s.is_empty()),
        district: comp.and_then(|c| c.district.clone()).filter(|s| !s.is_empty()),
        township: None,
        adcode: result
            .ad_info
            .as_ref()
            .and_then(|a| a.adcode.clone())
            .filter(|s| !s.is_empty()),
        address: result.address.filter(|s| !s.is_empty()),
        country: comp.and_then(|c| c.nation.clone()).filter(|s| !s.is_empty()),
    })
}

// ── Tianditu (天地图) reverse geocoding ──────────────────────────────────────

#[derive(Debug, Deserialize)]
struct TiandituResponse {
    status: Option<String>,
    result: Option<TiandituResult>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TiandituResult {
    formatted_address: Option<String>,
    address_component: Option<TiandituAddressComponent>,
}

#[derive(Debug, Deserialize)]
struct TiandituAddressComponent {
    city: Option<String>,
}

async fn tianditu_reverse_geocode(
    http: &Client,
    server_key: &str,
    lon: f64,
    lat: f64,
) -> Result<GeoLocation, AppError> {
    let post_str =
        format!("{{'lon':{lon:.6},'lat':{lat:.6},'ver':1}}");
    let url = format!(
        "http://api.tianditu.gov.cn/geocoder?postStr={post_str}&type=geocode&tk={server_key}"
    );

    let resp: TiandituResponse = http
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Tianditu HTTP error: {e}")))?
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("Tianditu JSON parse error: {e}")))?;

    if resp.status.as_deref() != Some("0") {
        return Err(AppError::Internal(format!(
            "Tianditu API error: status={:?}",
            resp.status
        )));
    }

    let result = resp
        .result
        .internal("Tianditu: no result in response")?;

    let city = result
        .address_component
        .as_ref()
        .and_then(|c| c.city.clone())
        .filter(|s| !s.is_empty());

    // Tianditu provides minimal structured data — parse province from formatted_address heuristic
    let province = result.formatted_address.as_deref().and_then(parse_province);

    Ok(GeoLocation {
        province,
        city,
        district: None,
        township: None,
        adcode: None,
        address: result.formatted_address.filter(|s| !s.is_empty()),
        country: None,
    })
}

/// Extract province from a Chinese formatted address string.
/// Chinese addresses typically start with province name (e.g., "北京市海淀区…", "广东省深圳市…").
fn parse_province(addr: &str) -> Option<String> {
    // Direct municipalities
    for m in &["北京市", "天津市", "上海市", "重庆市"] {
        if addr.starts_with(m) {
            return Some((*m).to_string());
        }
    }
    // Province ending with 省
    if let Some(idx) = addr.find('省') {
        let prov = &addr[..idx + '省'.len_utf8()];
        if prov.chars().count() <= 10 {
            return Some(prov.to_string());
        }
    }
    // Autonomous regions (自治区)
    for suffix in &["自治区"] {
        if let Some(idx) = addr.find(suffix) {
            let end = idx + suffix.len();
            let region = &addr[..end];
            if region.chars().count() <= 20 {
                return Some(region.to_string());
            }
        }
    }
    // Special administrative regions
    for sar in &["香港特别行政区", "澳门特别行政区"] {
        if addr.starts_with(sar) {
            return Some((*sar).to_string());
        }
    }
    None
}

// ── Mapbox reverse geocoding ─────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct MapboxResponse {
    features: Option<Vec<MapboxFeature>>,
}

#[derive(Debug, Deserialize)]
struct MapboxFeature {
    place_name: Option<String>,
    context: Option<Vec<MapboxContext>>,
}

#[derive(Debug, Deserialize)]
struct MapboxContext {
    id: Option<String>,
    text: Option<String>,
}

async fn mapbox_reverse_geocode(
    http: &Client,
    access_token: &str,
    lon: f64,
    lat: f64,
) -> Result<GeoLocation, AppError> {
    let url = format!(
        "https://api.mapbox.com/geocoding/v5/mapbox.places/{lon:.6},{lat:.6}.json\
         ?access_token={access_token}&language=zh&types=address,place,region,country"
    );

    let resp: MapboxResponse = http
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Mapbox HTTP error: {e}")))?
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("Mapbox JSON parse error: {e}")))?;

    let feature = resp
        .features
        .as_ref()
        .and_then(|f| f.first())
        .internal("Mapbox: no features in response")?;

    let (mut country, mut province, mut city, mut district) = (None, None, None, None);
    if let Some(ctx) = &feature.context {
        for item in ctx {
            let id = item.id.as_deref().unwrap_or_default();
            let text = item.text.clone().filter(|s| !s.is_empty());
            if id.starts_with("country.") {
                country = text;
            } else if id.starts_with("region.") {
                province = text;
            } else if id.starts_with("place.") {
                city = text;
            } else if id.starts_with("district.") {
                district = text;
            }
        }
    }

    Ok(GeoLocation {
        province,
        city,
        district,
        township: None,
        adcode: None,
        address: feature.place_name.clone().filter(|s| !s.is_empty()),
        country,
    })
}

// ── MapTiler reverse geocoding ───────────────────────────────────────────────

async fn maptiler_reverse_geocode(
    http: &Client,
    api_key: &str,
    lon: f64,
    lat: f64,
) -> Result<GeoLocation, AppError> {
    let url = format!(
        "https://api.maptiler.com/geocoding/{lon:.6},{lat:.6}.json?key={api_key}&language=zh"
    );

    // MapTiler uses a GeoJSON format compatible with Mapbox
    let resp: MapboxResponse = http
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("MapTiler HTTP error: {e}")))?
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("MapTiler JSON parse error: {e}")))?;

    let feature = resp
        .features
        .as_ref()
        .and_then(|f| f.first())
        .internal("MapTiler: no features in response")?;

    let (mut country, mut province, mut city, mut district) = (None, None, None, None);
    if let Some(ctx) = &feature.context {
        for item in ctx {
            let id = item.id.as_deref().unwrap_or_default();
            let text = item.text.clone().filter(|s| !s.is_empty());
            if id.starts_with("country.") {
                country = text;
            } else if id.starts_with("region.") {
                province = text;
            } else if id.starts_with("municipality.") {
                city = text;
            } else if id.starts_with("municipal_district.") {
                district = text;
            }
        }
    }

    Ok(GeoLocation {
        province,
        city,
        district,
        township: None,
        adcode: None,
        address: feature.place_name.clone().filter(|s| !s.is_empty()),
        country,
    })
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
                OnConflict::columns([
                    photo_geo_cache::Column::LatKey,
                    photo_geo_cache::Column::LonKey,
                ])
                .do_nothing()
                .to_owned(),
            )
            .exec(db)
            .await
            .ok(); // ignore duplicate insert races

        Ok(geo)
    }

    /// Batch reverse-geocode all photos in an app that have GPS but no geo data.
    pub async fn reverse_geocode_app(
        db: &DatabaseConnection,
        http: &Client,
        app_id: Uuid,
    ) -> Result<u32, AppError> {
        let settings: PhotoGeoSettings = SystemConfigRepo::get(db).await?;
        if !settings.enabled || !provider_has_key(&settings) {
            return Err(AppError::Internal(
                "Reverse geocoding not enabled or API key missing".into(),
            ));
        }

        // Find photos with GPS but no geo province
        let pending = photos::Entity::find()
            .filter(photos::Column::AppId.eq(app_id))
            .filter(photos::Column::GpsLatitude.is_not_null())
            .filter(photos::Column::GpsLongitude.is_not_null())
            .filter(photos::Column::GeoProvince.is_null())
            .filter(photos::Column::DeletedAt.is_null())
            .all(db)
            .await?;

        let total = pending.len();
        if total == 0 {
            info!("No photos need reverse geocoding for app {app_id}");
            return Ok(0);
        }

        info!("Reverse geocoding {total} photos for app {app_id}");
        let mut success_count = 0u32;

        for photo in &pending {
            let Some(lat) = photo.gps_latitude else {
                continue;
            };
            let Some(lon) = photo.gps_longitude else {
                continue;
            };

            match Self::resolve_location(db, http, &settings, lat, lon).await {
                Ok(geo) => {
                    // Build formatted location name
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
                        error!("Failed to update photo {} geo: {e}", photo.id);
                    } else {
                        success_count += 1;
                    }
                }
                Err(e) => {
                    warn!("Geocode failed for photo {} ({lat},{lon}): {e}", photo.id);
                    // Rate limit: sleep briefly on API errors
                    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                }
            }

            // Rate limit: ~5 req/s to stay within free tier
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        }

        info!("Reverse geocoding done: {success_count}/{total} photos updated");
        Ok(success_count)
    }

    /// Get location stats for an app (grouped by province/city/district).
    pub async fn location_stats(
        db: &DatabaseConnection,
        app_id: Uuid,
    ) -> Result<Vec<LocationGroup>, AppError> {
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
