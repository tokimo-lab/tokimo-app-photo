use sea_orm::DerivePartialModel;
use sea_orm::entity::prelude::DateTimeWithTimeZone;
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;

use crate::db::ApiDateTimeExt;
use crate::db::entities::{photo_albums, photos};

/// Photo list item (timeline / grid view)
#[derive(Debug, Clone, Serialize, DerivePartialModel, TS)]
#[sea_orm(entity = "photos::Entity")]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PhotoOutput {
    #[ts(type = "string")]
    pub id: Uuid,
    #[ts(type = "string")]
    pub app_id: Uuid,
    pub filename: String,
    pub path: String,
    pub title: Option<String>,
    pub width: Option<i32>,
    pub height: Option<i32>,
    #[ts(type = "number | null")]
    pub file_size: Option<i64>,
    pub mime_type: Option<String>,
    #[ts(type = "string | null")]
    pub taken_at: Option<DateTimeWithTimeZone>,
    pub thumbnail_path: Option<String>,
    pub is_favorite: bool,
    pub camera_make: Option<String>,
    pub camera_model: Option<String>,
    pub orientation: Option<i32>,
    pub live_video_path: Option<String>,
    #[ts(type = "string | null")]
    pub source_id: Option<Uuid>,
}

/// Full photo detail with all EXIF data
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PhotoDetailOutput {
    pub id: String,
    pub app_id: String,
    pub filename: String,
    pub path: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub width: Option<i32>,
    pub height: Option<i32>,
    #[ts(type = "number | null")]
    pub file_size: Option<i64>,
    pub mime_type: Option<String>,
    pub taken_at: Option<String>,
    pub camera_make: Option<String>,
    pub camera_model: Option<String>,
    pub lens_model: Option<String>,
    pub focal_length: Option<f64>,
    pub aperture: Option<f64>,
    pub shutter_speed: Option<String>,
    pub iso: Option<i32>,
    pub orientation: Option<i32>,
    pub gps_latitude: Option<f64>,
    pub gps_longitude: Option<f64>,
    pub gps_altitude: Option<f64>,
    pub location_name: Option<String>,
    pub geo_province: Option<String>,
    pub geo_city: Option<String>,
    pub geo_district: Option<String>,
    pub geo_township: Option<String>,
    pub geo_adcode: Option<String>,
    pub geo_address: Option<String>,
    pub thumbnail_path: Option<String>,
    pub live_video_path: Option<String>,
    pub is_favorite: bool,
    pub is_hidden: bool,
    pub source_id: Option<String>,
    pub scanned_at: Option<String>,
    pub ocr_scanned_at: Option<String>,
    #[ts(type = "{ detModel: string; vlmModel: string; detTexts: string[]; vlmText: string } | null")]
    pub ocr_debug_info: Option<serde_json::Value>,
    pub created_at: Option<String>,
    #[ts(type = "Record<string, string> | null")]
    pub exif_data: Option<serde_json::Value>,
}

impl From<photos::Model> for PhotoDetailOutput {
    fn from(m: photos::Model) -> Self {
        Self {
            id: m.id.to_string(),
            app_id: m.app_id.to_string(),
            filename: m.filename,
            path: m.path,
            title: m.title,
            description: m.description,
            width: m.width,
            height: m.height,
            file_size: m.file_size,
            mime_type: m.mime_type,
            taken_at: m.taken_at.to_api_datetime(),
            camera_make: m.camera_make,
            camera_model: m.camera_model,
            lens_model: m.lens_model,
            focal_length: m.focal_length,
            aperture: m.aperture,
            shutter_speed: m.shutter_speed,
            iso: m.iso,
            orientation: m.orientation,
            gps_latitude: m.gps_latitude,
            gps_longitude: m.gps_longitude,
            gps_altitude: m.gps_altitude,
            location_name: m.location_name,
            geo_province: m.geo_province,
            geo_city: m.geo_city,
            geo_district: m.geo_district,
            geo_township: m.geo_township,
            geo_adcode: m.geo_adcode,
            geo_address: m.geo_address,
            thumbnail_path: m.thumbnail_path,
            live_video_path: m.live_video_path,
            is_favorite: m.is_favorite,
            is_hidden: m.is_hidden,
            source_id: m.source_id.map(|u| u.to_string()),
            scanned_at: m.scanned_at.to_api_datetime(),
            ocr_scanned_at: m.ocr_scanned_at.to_api_datetime(),
            ocr_debug_info: m.ocr_debug_info,
            created_at: m.created_at.to_api_datetime(),
            exif_data: m.exif_data,
        }
    }
}

/// Resolved stream target for a photo — minimal info to locate and stream
/// the physical file via VFS.
#[derive(Debug)]
pub struct PhotoStreamTarget {
    pub path: String,
    pub mime_type: Option<String>,
    pub thumbnail_path: Option<String>,
    pub live_video_path: Option<String>,
    pub source_id: Option<String>,
    pub source_type: Option<String>,
    pub source_config: Option<serde_json::Value>,
}

/// Subdirectory info returned by the folders endpoint.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderInfo {
    pub name: String,
    pub path: String,
    pub photo_count: i64,
    pub cover_photo_id: Option<String>,
}

/// Person summary (face recognition)
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PersonOutput {
    #[ts(type = "string")]
    pub id: String,
    pub name: Option<String>,
    pub face_count: i32,
    pub avatar_photo_id: Option<String>,
    pub avatar_thumbnail_path: Option<String>,
}

/// A single detected face in a photo, with optional person info.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PhotoFaceOutput {
    #[ts(type = "number")]
    pub id: i32,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub confidence: Option<f64>,
    pub person_id: Option<String>,
    pub person_name: Option<String>,
}

/// Photo library (dedicated table, decoupled from `apps`)
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PhotoLibraryOutput {
    pub id: String,
    pub name: String,
    pub r#type: String,
    pub avatar: Option<serde_json::Value>,
    pub description: Option<String>,
    pub poster_path: Option<String>,
    pub scrape_enabled: bool,
    pub sort_order: i32,
    pub settings: Option<serde_json::Value>,
    pub sync_status: String,
    pub last_sync_at: Option<String>,
    #[ts(type = "number")]
    pub item_count: i64,
    pub sources: Vec<PhotoLibrarySourceOutput>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Clone, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PhotoLibrarySourceOutput {
    pub source_id: String,
    pub root_path: String,
    pub sort_order: i32,
    pub is_default_download: bool,
    pub source_name: Option<String>,
    pub source_type: Option<String>,
}

/// Photo album list item
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PhotoAlbumOutput {
    #[ts(type = "string")]
    pub id: Uuid,
    #[ts(type = "string")]
    pub app_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    #[ts(type = "string | null")]
    pub cover_photo_id: Option<Uuid>,
    pub album_type: String,
    #[ts(type = "string | null")]
    pub owner_user_id: Option<Uuid>,
    pub source_ref: Option<String>,
    pub source_label: Option<String>,
    pub source_meta: serde_json::Value,
    pub photo_count: i32,
}

#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PhotoAlbumSourceInput {
    pub kind: String,
    #[serde(rename = "ref")]
    pub source_ref: String,
    pub label: String,
    #[serde(default)]
    pub meta: serde_json::Value,
}

impl From<photo_albums::Model> for PhotoAlbumOutput {
    fn from(album: photo_albums::Model) -> Self {
        Self {
            id: album.id,
            app_id: album.app_id,
            name: album.name,
            description: album.description,
            cover_photo_id: album.cover_photo_id,
            album_type: album.album_type,
            owner_user_id: album.owner_user_id,
            source_ref: album.source_ref,
            source_label: album.source_label,
            source_meta: album.source_meta,
            photo_count: album.photo_count,
        }
    }
}
