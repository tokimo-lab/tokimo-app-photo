//! Embedded axum HTTP server on a UDS socket for the photo sidecar.

use std::sync::Arc;

use axum::{
    Router,
    routing::{delete, get, patch, post},
};
use tokimo_bus_protocol::{BusListener, DataPlaneSocket};
use tracing::{error, info};

use crate::{assets, ctx::AppCtx, handlers};

pub async fn spawn(service: &str, ctx: Arc<AppCtx>) -> anyhow::Result<DataPlaneSocket> {
    let (listener, socket) = BusListener::bind_for_app(service)?;
    info!(?socket, "photo: app server listening");

    let router = build_router(ctx);

    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, router).await {
            error!(error = %e, "photo: app server stopped");
        }
    });

    Ok(socket)
}

#[allow(clippy::too_many_lines)]
fn build_router(ctx: Arc<AppCtx>) -> Router {
    Router::new()
        // PhotoLibrary CRUD
        .route(
            "/",
            get(handlers::list_photo_libraries).post(handlers::create_photo_library),
        )
        .route("/reorder", post(handlers::reorder_photo_libraries))
        // Library browse routes
        .route("/{id}/photos", get(handlers::list_photos))
        .route("/{id}/photos/timeline", get(handlers::photo_timeline))
        .route("/{id}/photos/folders", get(handlers::list_folders))
        .route("/{id}/photos/timeline-index", get(handlers::timeline_index))
        // Albums (library-scoped)
        .route(
            "/{id}/photo-albums",
            get(handlers::list_photo_albums).post(handlers::create_album),
        )
        // Albums (album-scoped)
        .route("/albums/{id}", delete(handlers::delete_album))
        .route("/albums/{id}/photos", get(handlers::list_album_photos))
        .route(
            "/albums/{id}/add-photos",
            post(handlers::add_photos_to_album),
        )
        .route(
            "/albums/{id}/remove-photos",
            post(handlers::remove_photos_from_album),
        )
        // Individual photo
        .route(
            "/item/{id}",
            get(handlers::get_photo).patch(handlers::update_photo),
        )
        .route(
            "/item/{id}/toggle-favorite",
            post(handlers::toggle_favorite),
        )
        .route("/item/{id}/toggle-hidden", post(handlers::toggle_hidden))
        .route("/item/{id}/image", get(handlers::serve_photo_image))
        .route("/item/{id}/live-video", get(handlers::serve_live_video))
        .route("/item/{id}/similar", get(handlers::similar_photos))
        .route("/item/{id}/tags", get(handlers::photo_tags))
        .route("/item/{id}/faces", get(handlers::get_photo_faces))
        .route(
            "/item/{id}/faces/{face_id}/assign",
            patch(handlers::assign_face_to_person),
        )
        .route(
            "/item/{id}/faces/{face_id}/create-person",
            post(handlers::create_person_from_face),
        )
        .route("/item/{id}/refresh-faces", post(handlers::refresh_faces))
        .route("/item/{id}/refresh-ocr", post(handlers::refresh_ocr))
        .route("/item/{id}/refresh-clip", post(handlers::refresh_clip))
        .route("/item/{id}/refresh-exif", post(handlers::refresh_exif))
        .route(
            "/item/{id}/refresh-thumbnail",
            post(handlers::refresh_thumbnail),
        )
        .route(
            "/item/{id}/ocr-results",
            get(handlers::get_photo_ocr_results).post(handlers::create_ocr_result),
        )
        // Batch (library-scoped)
        .route(
            "/{id}/photos/batch-favorite",
            post(handlers::batch_favorite),
        )
        .route("/{id}/photos/batch-delete", post(handlers::batch_delete))
        .route("/{id}/photos/batch-hide", post(handlers::batch_hide))
        .route(
            "/{id}/photos/trash",
            get(handlers::list_trashed).post(handlers::trash_photos),
        )
        .route("/{id}/photos/restore", post(handlers::restore_photos))
        .route(
            "/{id}/photos/permanent-delete",
            post(handlers::permanent_delete),
        )
        .route("/{id}/photos/rescan", post(handlers::rescan))
        // Geo
        .route(
            "/{id}/photos/reverse-geocode",
            post(handlers::reverse_geocode),
        )
        .route("/{id}/photos/map-points", get(handlers::map_points))
        .route("/{id}/photos/locations", get(handlers::location_stats))
        .route(
            "/{id}/photos/by-location",
            get(handlers::photos_by_location),
        )
        .route("/{id}/photos/by-bbox", get(handlers::photos_by_bbox))
        // AI (library-scoped)
        .route("/{id}/photos/ocr-scan", post(handlers::ocr_scan))
        .route("/{id}/photos/ocr-search", get(handlers::ocr_search))
        .route(
            "/{id}/photos/ocr-results",
            delete(handlers::clear_ocr_results),
        )
        .route(
            "/{id}/photos/face-results",
            delete(handlers::clear_face_results),
        )
        .route(
            "/{id}/photos/clip-results",
            delete(handlers::clear_clip_results),
        )
        .route(
            "/{id}/photos/thumbnails",
            delete(handlers::clear_thumbnails),
        )
        .route("/{id}/photos/clip-embed", post(handlers::clip_embed))
        .route("/{id}/photos/clip-search", get(handlers::clip_search))
        .route("/{id}/photos/face-detect", post(handlers::face_detect))
        // Persons
        .route("/{id}/persons", get(handlers::list_persons))
        .route("/{id}/persons/merge", post(handlers::merge_persons))
        .route(
            "/{id}/persons/{person_id}/photos",
            get(handlers::person_photos),
        )
        .route("/{id}/persons/{person_id}", patch(handlers::rename_person))
        // OCR CRUD
        .route(
            "/ocr-results/{ocr_id}",
            patch(handlers::update_ocr_result).delete(handlers::delete_ocr_result),
        )
        // Settings
        .route(
            "/settings/geo",
            get(handlers::get_photo_geo_settings).put(handlers::update_photo_geo_settings),
        )
        .route(
            "/settings/geo/test",
            post(handlers::test_photo_geo_connection),
        )
        .route(
            "/settings/ai",
            get(handlers::get_photo_ai_settings).put(handlers::update_photo_ai_settings),
        )
        .route(
            "/settings/ai/test",
            post(handlers::test_photo_ai_connection),
        )
        .route(
            "/settings/ai/ocr-results",
            delete(handlers::clear_all_ocr_results),
        )
        // Library detail (after named routes)
        .route(
            "/{id}",
            get(handlers::get_photo_library)
                .patch(handlers::update_photo_library)
                .delete(handlers::delete_photo_library),
        )
        .route("/{id}/sync", post(handlers::sync_photo))
        // Assets
        .route("/assets/{*path}", get(assets::serve))
        .with_state(ctx)
}
