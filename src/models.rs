//! DTOs for photo app API responses.

use sea_orm::DerivePartialModel;
use sea_orm::entity::prelude::*;
use serde::Serialize;
use uuid::Uuid;

use crate::db::entities::{photo_albums, photo_faces, photo_persons, photos};

// ── Photo output types ──

/// Lightweight photo listing DTO (used with `into_partial_model`).
#[derive(Debug, Serialize, DerivePartialModel)]
#[sea_orm(entity = "photos::Entity")]
#[serde(rename_all = "camelCase")]
pub struct PhotoOutput {
    pub id: Uuid,
    pub app_id: Uuid,
    pub source_id: Option<Uuid>,
    pub filename: String,
    pub path: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub file_size: Option<i64>,
    pub mime_type: Option<String>,
    pub taken_at: Option<DateTimeWithTimeZone>,
    pub camera_make: Option<String>,
    pub camera_model: Option<String>,
    pub is_favorite: bool,
    pub is_hidden: bool,
    pub thumbnail_path: Option<String>,
    pub live_video_path: Option<String>,
    pub color_dominant: Option<String>,
    pub deleted_at: Option<DateTimeWithTimeZone>,
    pub created_at: Option<DateTimeWithTimeZone>,
    pub updated_at: Option<DateTimeWithTimeZone>,
}

/// Full photo detail output.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoDetailOutput {
    pub id: String,
    pub app_id: String,
    pub source_id: Option<String>,
    pub filename: String,
    pub path: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub width: Option<i32>,
    pub height: Option<i32>,
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
    pub exif_data: Option<serde_json::Value>,
    pub gps_latitude: Option<f64>,
    pub gps_longitude: Option<f64>,
    pub gps_altitude: Option<f64>,
    pub location_name: Option<String>,
    pub geo_province: Option<String>,
    pub geo_city: Option<String>,
    pub geo_district: Option<String>,
    pub geo_address: Option<String>,
    pub is_favorite: bool,
    pub is_hidden: bool,
    pub thumbnail_path: Option<String>,
    pub live_video_path: Option<String>,
    pub color_dominant: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

impl From<photos::Model> for PhotoDetailOutput {
    fn from(m: photos::Model) -> Self {
        Self {
            id: m.id.to_string(),
            app_id: m.app_id.to_string(),
            source_id: m.source_id.map(|u| u.to_string()),
            filename: m.filename,
            path: m.path,
            title: m.title,
            description: m.description,
            width: m.width,
            height: m.height,
            file_size: m.file_size,
            mime_type: m.mime_type,
            taken_at: m.taken_at.map(|d| d.to_rfc3339()),
            camera_make: m.camera_make,
            camera_model: m.camera_model,
            lens_model: m.lens_model,
            focal_length: m.focal_length,
            aperture: m.aperture,
            shutter_speed: m.shutter_speed,
            iso: m.iso,
            orientation: m.orientation,
            exif_data: m.exif_data,
            gps_latitude: m.gps_latitude,
            gps_longitude: m.gps_longitude,
            gps_altitude: m.gps_altitude,
            location_name: m.location_name,
            geo_province: m.geo_province,
            geo_city: m.geo_city,
            geo_district: m.geo_district,
            geo_address: m.geo_address,
            is_favorite: m.is_favorite,
            is_hidden: m.is_hidden,
            thumbnail_path: m.thumbnail_path,
            live_video_path: m.live_video_path,
            color_dominant: m.color_dominant,
            created_at: m.created_at.map(|d| d.to_rfc3339()),
            updated_at: m.updated_at.map(|d| d.to_rfc3339()),
        }
    }
}

/// Minimal info needed to stream a photo file via VFS.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoStreamTarget {
    pub path: String,
    pub mime_type: Option<String>,
    pub thumbnail_path: Option<String>,
    pub live_video_path: Option<String>,
    pub source_id: Option<String>,
    pub source_type: Option<String>,
    pub source_config: Option<serde_json::Value>,
}

/// Folder info for directory browsing.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderInfo {
    pub name: String,
    pub path: String,
    pub photo_count: i64,
}

// ── Album output types ──

#[derive(Debug, Serialize, DerivePartialModel)]
#[sea_orm(entity = "photo_albums::Entity")]
#[serde(rename_all = "camelCase")]
pub struct PhotoAlbumOutput {
    pub id: Uuid,
    pub app_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub cover_photo_id: Option<Uuid>,
    pub sort_order: i32,
    pub created_at: Option<DateTimeWithTimeZone>,
    pub updated_at: Option<DateTimeWithTimeZone>,
}

// ── Library output types ──

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoLibraryOutput {
    pub id: String,
    pub name: String,
    pub r#type: String,
    pub avatar: Option<serde_json::Value>,
    pub description: Option<String>,
    pub poster_path: Option<String>,
    pub scrape_enabled: Option<bool>,
    pub sort_order: i32,
    pub settings: Option<serde_json::Value>,
    pub sync_status: Option<String>,
    pub last_sync_at: Option<String>,
    pub item_count: i64,
    pub sources: Vec<PhotoLibrarySourceOutput>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoLibrarySourceOutput {
    pub source_id: String,
    pub root_path: String,
    pub sort_order: i32,
    pub is_default_download: bool,
    pub source_name: Option<String>,
    pub source_type: Option<String>,
}

// ── Person / Face output types ──

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonOutput {
    pub id: String,
    pub name: String,
    pub face_count: i64,
    pub representative_face_id: Option<String>,
    pub representative_photo_path: Option<String>,
}

#[derive(Debug, Serialize, DerivePartialModel)]
#[sea_orm(entity = "photo_faces::Entity")]
#[serde(rename_all = "camelCase")]
pub struct PhotoFaceOutput {
    pub id: Uuid,
    pub photo_id: Uuid,
    pub person_id: Option<Uuid>,
    pub bbox_x: Option<f64>,
    pub bbox_y: Option<f64>,
    pub bbox_w: Option<f64>,
    pub bbox_h: Option<f64>,
    pub confidence: Option<f64>,
    pub created_at: Option<DateTimeWithTimeZone>,
}
