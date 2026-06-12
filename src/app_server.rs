//! 内嵌 axum HTTP server，监听本地 socket。
//!
//! 路由布局（server 端 `/api/apps/helloworld/<rest>` 反代到本 sock 的 `/<rest>`）：
//! - `GET    /items`                   → 列表
//! - `POST   /items`                   → 新增
//! - `PUT    /items/{id}`              → 更新（需认证）
//! - `DELETE /items/{id}`              → 删除
//! - `POST   /items/notify`            → 新增并触发通知（需认证）
//! - `POST   /greet`                   → 演示 typed JSON
//! - `POST   /echo`                    → 透传 body
//! - `GET    /assets/{*path}`          → 静态资源
//! - `GET    /data/hello.txt`          → 数据流示例
//!
//! 单 sock 同时承载控制面 + 数据面 + 资源面，server 侧只需一条反代规则。

use std::sync::Arc;

use axum::{
    Router,
    routing::{any, get, post, put},
};
use tokimo_bus_protocol::{BusListener, DataPlaneSocket};
use tracing::{error, info};

use crate::{assets, handlers, handlers::AppCtx};

/// 起 axum server 监听本地 socket，返回 `DataPlaneSocket` 用于上报 broker。
pub async fn spawn(service: &str, ctx: Arc<AppCtx>) -> anyhow::Result<DataPlaneSocket> {
    let (listener, socket) = BusListener::bind_for_app(service)?;
    info!(?socket, "helloworld: app server listening");

    let router = build_router(ctx);

    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, router).await {
            error!(error = %e, "helloworld: app server stopped");
        }
    });

    Ok(socket)
}

fn build_router(ctx: Arc<AppCtx>) -> Router {
    Router::new()
        .route("/items", get(handlers::items_list).post(handlers::items_add))
        .route(
            "/items/{id}",
            put(handlers::items_update).delete(handlers::items_delete),
        )
        .route("/items/notify", post(handlers::items_add_with_notify))
        .route("/jobs/start", post(handlers::start_job))
        .route("/greet", post(handlers::greet))
        .route("/echo", any(handlers::echo))
        .route("/assets/{*path}", get(assets::serve))
        .route("/data/hello.txt", get(handlers::data_hello))
        .with_state(ctx)
}
