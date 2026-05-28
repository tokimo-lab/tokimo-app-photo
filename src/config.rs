//! Photo-app sidecar settings — faithful port of presplit `apps/photo/config.rs`,
//! re-targeted onto the sidecar-owned [`AppSettingsRepo`] (instead of the host's
//! `SystemConfigRepo`).
//!
//! Two sections are stored:
//! - `photo.geo` → [`PhotoGeoSettings`] (reverse-geocoding provider + keys)
//! - `photo.ai`  → [`PhotoAiSettings`] (OCR / CLIP / face toggles + model names)
//!
//! [`PhotoAiSettings::for_app`] keeps the per-library override semantics from
//! the presplit code: `photo_libraries.settings` JSON object lookups merged on
//! top of the global defaults.

use sea_orm::EntityTrait;
use serde::{Deserialize, Serialize};

use crate::db::repos::app_settings_repo::AppSettingsSection;
use crate::error::AppError;

// ── PhotoGeoSettings ─────────────────────────────────────────────────────────

/// Photo geo-location reverse geocoding settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoGeoSettings {
    pub provider: String, // "amap" | "qqmap" | "tianditu" | "mapbox" | "maptiler"
    pub enabled: bool,
    pub amap_api_key: Option<String>,
    pub amap_secret: Option<String>,
    pub amap_js_api_key: Option<String>,
    pub qqmap_api_key: Option<String>,
    pub qqmap_secret_key: Option<String>,
    pub tianditu_server_key: Option<String>,
    pub tianditu_browser_key: Option<String>,
    pub mapbox_access_token: Option<String>,
    pub maptiler_api_key: Option<String>,
    pub fallback_provider: Option<String>,
}

impl AppSettingsSection for PhotoGeoSettings {
    const KEY: &'static str = "photo.geo";

    fn default_value() -> Self {
        Self {
            provider: "amap".to_string(),
            enabled: false,
            amap_api_key: None,
            amap_secret: None,
            amap_js_api_key: None,
            qqmap_api_key: None,
            qqmap_secret_key: None,
            tianditu_server_key: None,
            tianditu_browser_key: None,
            mapbox_access_token: None,
            maptiler_api_key: None,
            fallback_provider: None,
        }
    }
}

// ── PhotoAiSettings ──────────────────────────────────────────────────────────

/// Photo AI settings (OCR, CLIP, face recognition).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoAiSettings {
    pub ocr_enabled: bool,
    pub clip_enabled: bool,
    pub face_enabled: bool,
    #[serde(default = "default_ocr_model")]
    pub ocr_model_name: String,
    #[serde(default)]
    pub ocr_aux_model_name: Option<String>,
    #[serde(default)]
    pub ocr_det_max_side: Option<u32>,
}

fn default_ocr_model() -> String {
    "rapid-ocr-rust".to_string()
}

impl AppSettingsSection for PhotoAiSettings {
    const KEY: &'static str = "photo.ai";

    fn default_value() -> Self {
        Self {
            ocr_enabled: true,
            clip_enabled: true,
            face_enabled: true,
            ocr_model_name: default_ocr_model(),
            ocr_aux_model_name: None,
            ocr_det_max_side: None,
        }
    }
}

impl PhotoAiSettings {
    /// Resolve effective AI settings for a specific app.
    /// Per-app flags override globals; missing keys fall back to global.
    #[allow(dead_code)] // wired up by AI services in a follow-up commit
    pub async fn for_app(
        db: &sea_orm::DatabaseConnection,
        app_id: uuid::Uuid,
    ) -> Result<Self, AppError> {
        use crate::db::repos::app_settings_repo::AppSettingsRepo;

        let global: Self = AppSettingsRepo::get(db).await?;

        let app = crate::db::entities::photo_libraries::Entity::find_by_id(app_id)
            .one(db)
            .await?;
        let app_settings = app
            .as_ref()
            .and_then(|a| a.settings.as_ref())
            .cloned()
            .unwrap_or(serde_json::json!({}));

        let flag = |key: &str, global_val: bool| -> bool {
            app_settings
                .get(key)
                .and_then(sea_orm::JsonValue::as_bool)
                .unwrap_or(global_val)
        };
        let str_field = |key: &str, global_val: &str| -> String {
            app_settings
                .get(key)
                .and_then(|v| v.as_str())
                .map_or_else(|| global_val.to_string(), std::string::ToString::to_string)
        };
        let opt_str = |key: &str, global_val: &Option<String>| -> Option<String> {
            if let Some(v) = app_settings.get(key) {
                v.as_str().map(std::string::ToString::to_string)
            } else {
                global_val.clone()
            }
        };

        Ok(Self {
            ocr_enabled: flag("autoOcr", global.ocr_enabled),
            clip_enabled: flag("autoClip", global.clip_enabled),
            face_enabled: flag("autoFace", global.face_enabled),
            ocr_model_name: str_field("ocrModelName", &global.ocr_model_name),
            ocr_aux_model_name: opt_str("ocrAuxModelName", &global.ocr_aux_model_name),
            ocr_det_max_side: global.ocr_det_max_side,
        })
    }
}
