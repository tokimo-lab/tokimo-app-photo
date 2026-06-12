//! Embedded axum HTTP server, listening on a local UDS socket.
//!
//! Route layout: server-side `/api/apps/photo/<rest>` proxies to this socket's `/<rest>`.

use std::sync::Arc;

use axum::{Router, routing::get};
use tokimo_bus_protocol::{BusListener, DataPlaneSocket};
use tracing::{error, info};

use crate::{AppCtx, assets, router};

/// Spawn axum server on a local socket, return `DataPlaneSocket` for broker registration.
pub async fn spawn(service: &str, ctx: Arc<AppCtx>) -> anyhow::Result<DataPlaneSocket> {
    let (listener, socket) = BusListener::bind_for_app(service)?;
    info!(?socket, "photo: app server listening");

    let app_router = build_router(ctx);

    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app_router).await {
            error!(error = %e, "photo: app server stopped");
        }
    });

    Ok(socket)
}

fn build_router(ctx: Arc<AppCtx>) -> Router {
    // The photo router defines routes with `/api/apps/photo/...` prefix,
    // but the server proxy strips that prefix before forwarding to this socket.
    // So we mount the photo routes at root AND also at the full prefix for direct access.
    let photo_routes = router::build_photo_app_routes();

    Router::new()
        .merge(photo_routes)
        .route("/assets/{*path}", get(assets::serve))
        .with_state(ctx)
}
