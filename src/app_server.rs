//! 内嵌 axum HTTP server，监听本地 socket。
//!
//! 路由布局（server 端 `/api/apps/photo/<rest>` 反代到本 sock 的 `/<rest>`）：
//! - PhotoLibrary CRUD
//! - Library-scoped browse / albums / batch / geo / AI / persons
//! - Global settings
//!
//! 单 sock 同时承载控制面 + 数据面 + 资源面，server 侧只需一条反代规则。

use std::sync::Arc;

use axum::Router;
use axum::middleware;
use axum::routing::get;
use tokimo_bus_protocol::{BusListener, DataPlaneSocket};
use tracing::{error, info};

use crate::assets;
use crate::state::AppState;

/// 起 axum server 监听本地 socket，返回 `DataPlaneSocket` 用于上报 broker。
pub async fn spawn(service: &str, ctx: Arc<AppState>) -> anyhow::Result<DataPlaneSocket> {
    let (listener, socket) = BusListener::bind_for_app(service)?;
    info!(?socket, "photo: app server listening");

    let router = crate::router::build_photo_app_routes()
        .route("/assets/{*path}", get(assets::serve))
        .layer(middleware::from_fn(
            tokimo_bus_protocol::task_local::auth_middleware,
        ))
        .with_state(ctx);

    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, router).await {
            error!(error = %e, "photo: app server stopped");
        }
    });

    Ok(socket)
}
