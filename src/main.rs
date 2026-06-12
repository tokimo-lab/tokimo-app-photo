//! Helloworld app — 方案 3 形态：内嵌 axum + UDS。
//!
//! 启动流程：
//! 1. 连接 broker（仅用于 supervisor 健康检查 + 可选的 cross-app `notification_center.notify`）
//! 2. 起 axum router 监听 `<runtime_dir>/apps/helloworld.sock`
//! 3. 把这个 sock 报给 broker（沿用 `data_plane_socket` 字段）
//! 4. server 端的 `/api/apps/helloworld/<rest>` 全部反代到这个 sock 的 `/<rest>`
//!
//! 与旧版的差别：
//! - 不再调用 `BusClient::builder().method(...).on_invoke(...)`
//! - 业务路由改成标准 axum handler signature
//! - 数据流 / 静态资源 / 业务方法 共用同一个 sock（同一个 axum router）

/// Compile-time embedded app manifest; shared with the library crate via lib.rs.
const MANIFEST: &str = include_str!("../tokimo-app.toml");

mod app_server;
mod assets;
mod bus_clients;
mod cli;
mod db;
mod handlers;

use std::sync::{Arc, OnceLock};

use axum::{Json, http::StatusCode, response::IntoResponse};
use clap::{Parser, Subcommand};
use tokimo_bus_cli::TokimoAuthArgs;
use tokimo_bus_client::{BusClient, ClientConfig};
use tracing::{error, info};

/// 统一错误响应（与 lib.rs 共享同一定义，binary crate 内模块通过 `crate::AppError` 引用）。
#[derive(Debug)]
pub struct AppError {
    pub status: StatusCode,
    pub message: String,
}

impl AppError {
    pub fn bad_request(msg: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: msg.into(),
        }
    }
    pub fn internal(msg: impl Into<String>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: msg.into(),
        }
    }
    pub fn not_found(msg: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message: msg.into(),
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> axum::response::Response {
        let body = serde_json::json!({ "error": self.message });
        (self.status, Json(body)).into_response()
    }
}

impl From<sea_orm::DbErr> for AppError {
    fn from(e: sea_orm::DbErr) -> Self {
        Self::internal(format!("db: {e}"))
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for AppError {}

#[derive(Parser, Debug)]
#[command(
    name = "tokimo-app-helloworld",
    about = "Helloworld — Tokimo app CLI",
    long_about = "Helloworld CLI — directly read/write Tokimo database to manage helloworld items.\n\nCLI reads/writes the database directly; no main server process needed.",
    term_width = 100
)]
struct Cli {
    #[command(flatten)]
    auth: TokimoAuthArgs,
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand, Debug)]
enum Command {
    /// Manage helloworld items
    #[command(
        subcommand_required = false,
        arg_required_else_help = false,
        long_about = "Manage helloworld items",
        term_width = 100
    )]
    Items {
        #[command(subcommand)]
        cmd: Option<ItemsCmd>,
    },
    /// Print greeting
    Greet { name: String },
}

#[derive(Subcommand, Debug)]
pub(crate) enum ItemsCmd {
    /// List latest 100 items
    List,
    /// Add a new item
    Add {
        /// Item content (non-empty string)
        content: String,
    },
    /// Update item content
    Update {
        /// Item ID (UUID)
        id: uuid::Uuid,
        /// New content
        content: String,
    },
    /// Delete specified item
    Delete {
        /// item ID (UUID)
        id: uuid::Uuid,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let Cli { auth, command } = Cli::parse();

    match command {
        None if std::env::var_os("TOKIMO_BUS_SOCKET").is_some() => {
            // server 模式：由 supervisor 无参拉起（注入了 TOKIMO_BUS_SOCKET），初始化 tracing
            tracing_subscriber::fmt()
                .with_env_filter(
                    tracing_subscriber::EnvFilter::try_from_default_env()
                        .unwrap_or_else(|_| "info,tokimo_bus_client=info,tokimo_app_helloworld=debug".into()),
                )
                .init();
            if let Err(error) = run_server().await {
                error!(%error, "helloworld: fatal");
                std::process::exit(1);
            }
        }
        None => {
            // 人手动无参运行：打印 CLI help 而不是进 server 模式
            use clap::CommandFactory;
            let mut cmd = Cli::command();
            tokimo_bus_cli::print_help_unified(&mut cmd);
            std::process::exit(0);
        }
        Some(cmd) => {
            // CLI 模式：纯文本错误，不输出 tracing 日志
            let result = match cmd {
                Command::Items { cmd: None } => {
                    use clap::CommandFactory;
                    let mut root = Cli::command();
                    root.build();
                    if let Some(items_cmd) = root.find_subcommand_mut("items") {
                        tokimo_bus_cli::print_help_unified(items_cmd);
                    }
                    std::process::exit(0);
                }
                Command::Items { cmd: Some(c) } => cli::run_items(auth, c).await,
                Command::Greet { name } => cli::run_greet(auth, name).await,
            };
            if let Err(error) = result {
                eprintln!("Error: {error:#}");
                std::process::exit(1);
            }
        }
    }

    Ok(())
}

async fn run_server() -> anyhow::Result<()> {
    let cfg = ClientConfig::from_env().map_err(|e| anyhow::anyhow!("ClientConfig: {e}"))?;
    info!(endpoint = ?cfg.endpoint, "helloworld: connecting to broker");

    let db = db::init_pool().await?;
    info!("photo: db connected (schema managed by host)");

    let ai_settings: crate::config::PhotoAiWorkerSettings =
        crate::db::repos::app_settings_repo::AppSettingsRepo::get(&db)
            .await
            .unwrap_or_default();
    let data_local_path = std::env::var("TOKIMO_DATA_LOCAL_PATH").map_or_else(
        |_| std::path::PathBuf::from("./.data/local"),
        std::path::PathBuf::from,
    );
    let perception_settings = tokimo_perception::worker::client::AiWorkerSettings {
        mode: ai_settings.mode,
        remote_url: ai_settings.remote_url,
        keepalive_always: ai_settings.keepalive_always,
        idle_timeout_secs: ai_settings.idle_timeout_secs,
        worker_binary: ai_settings.worker_binary,
        socket_path: ai_settings.socket_path,
        models_dir: None,
    };
    let ai = tokimo_perception::worker::client::AiWorkerClient::from_settings(
        &perception_settings,
        &data_local_path,
    );

    // BusClient 仍然存在 —— 不为暴露方法，而是：
    // 1) 让 broker 知道 helloworld 在线（supervisor 健康检查）
    // 2) 提供 cross-app `bus.call("notification_center", "notify", ...)` 通道
    let client_slot: Arc<OnceLock<Arc<BusClient>>> = Arc::new(OnceLock::new());
    let ctx = Arc::new(handlers::AppCtx {
        db,
        client: Arc::clone(&client_slot),
    });

    // 起 axum router 监听 UDS（业务 + assets + data 都在这个 sock 上）
    let app_socket = app_server::spawn("helloworld", Arc::clone(&ctx))
        .await
        .map_err(|e| anyhow::anyhow!("app_server spawn: {e}"))?;

    // 把 sock 通过 `data_plane_socket` 上报给 broker（server 用它做反代目的地）
    let client = BusClient::builder(cfg)
        .service("helloworld", env!("CARGO_PKG_VERSION"))
        .data_plane(app_socket)
        .build()
        .await
        .map_err(|e| anyhow::anyhow!("bus build: {e}"))?;
    client_slot
        .set(Arc::clone(&client))
        .map_err(|_| anyhow::anyhow!("client_slot already set"))?;

    // Wire the notification module so it can send real notifications via the bus.
    crate::services::notifications::init(Arc::clone(&client));

    // Register job handlers with the main server (appId inferred from bus caller).
    bus_clients::jobs::register_handler(&client, "photo_clip_scan", "dispatch_photo_clip_scan")
        .await?;
    bus_clients::jobs::register_handler(&client, "photo_clip", "dispatch_photo_clip").await?;
    bus_clients::jobs::register_handler(&client, "photo_clip_single", "dispatch_photo_clip_single")
        .await?;
    bus_clients::jobs::register_handler(&client, "photo_face_scan", "dispatch_photo_face_scan")
        .await?;
    bus_clients::jobs::register_handler(&client, "photo_face", "dispatch_photo_face").await?;
    bus_clients::jobs::register_handler(&client, "photo_face_single", "dispatch_photo_face_single")
        .await?;
    bus_clients::jobs::register_handler(&client, "photo_ocr_scan", "dispatch_photo_ocr_scan")
        .await?;
    bus_clients::jobs::register_handler(&client, "photo_ocr", "dispatch_photo_ocr").await?;
    bus_clients::jobs::register_handler(&client, "photo_ocr_single", "dispatch_photo_ocr_single")
        .await?;
    bus_clients::jobs::register_handler(
        &client,
        "photo_geocode_scan",
        "dispatch_photo_geocode_scan",
    )
    .await?;
    bus_clients::jobs::register_handler(&client, "photo_geocode", "dispatch_photo_geocode").await?;
    bus_clients::jobs::register_handler(&client, "file_scrape", "dispatch_file_scrape").await?;

    info!("photo: registered with broker");

    let shutdown = {
        let client = Arc::clone(&client);
        tokio::spawn(async move { client.run_until_shutdown().await })
    };

    tokio::select! {
        _ = tokio::signal::ctrl_c() => {
            info!("helloworld: SIGINT received");
            client.shutdown();
        }
        _ = shutdown => info!("helloworld: broker sent Shutdown"),
    }

    Ok(())
}
