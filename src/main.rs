//! Photo app — 内嵌 axum + UDS sidecar 形态。
//!
//! 启动流程：
//! 1. 连接 broker（健康检查 + cross-app bus call）
//! 2. 起 axum router 监听 `<runtime_dir>/apps/photo.sock`
//! 3. 报 sock 给 broker（`data_plane_socket`）
//! 4. 主 server 把 `/api/apps/photo/<rest>` 全部反代到本 sock 的 `/<rest>`

/// Compile-time embedded app manifest; shared with the library crate via lib.rs.
const MANIFEST: &str = include_str!("../tokimo-app.toml");

mod app_server;
mod assets;
mod bus_clients;
mod bus_services;
mod common;
mod config;
mod db;
mod error;
mod handlers;
mod models;
mod queue;
mod repos;
mod router;
mod services;
mod state;

use std::path::PathBuf;
use std::sync::{Arc, OnceLock};

use clap::Parser;
use tokimo_bus_cli::TokimoAuthArgs;
use tokimo_bus_client::{BusClient, ClientConfig};
use tracing::{error, info};

use crate::config::PhotoAiSettings;
use crate::db::repos::system_config_repo::{SystemConfigRepo, SystemConfigSection};
use crate::services::source::SourceRegistry;
use crate::state::AppState;

fn data_local_path() -> PathBuf {
    std::env::var("TOKIMO_DATA_LOCAL_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("./.data/local"))
}

#[derive(Parser, Debug)]
#[command(
    name = "tokimo-app-photo",
    about = "Tokimo Photo — 库 / 浏览 / AI (OCR / CLIP / 人脸) / 地理 / 相册",
    long_about = "Tokimo Photo CLI — manage photo libraries, sync sources, and run AI analysis.",
    term_width = 100
)]
struct Cli {
    #[command(flatten)]
    auth: TokimoAuthArgs,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let Cli { auth: _ } = Cli::parse();

    if std::env::var_os("TOKIMO_BUS_SOCKET").is_some() {
        // server 模式：由 supervisor 无参拉起（注入了 TOKIMO_BUS_SOCKET）
        tracing_subscriber::fmt()
            .with_env_filter(
                tracing_subscriber::EnvFilter::try_from_default_env()
                    .unwrap_or_else(|_| "info,tokimo_bus_client=info,tokimo_app_photo=debug".into()),
            )
            .init();
        if let Err(error) = run_server().await {
            error!(%error, "photo: fatal");
            std::process::exit(1);
        }
    } else {
        // 人手动无参运行：打印 CLI help
        use clap::CommandFactory;
        let mut cmd = Cli::command();
        tokimo_bus_cli::print_help_unified(&mut cmd);
        std::process::exit(0);
    }

    Ok(())
}

async fn run_server() -> anyhow::Result<()> {
    let cfg = ClientConfig::from_env().map_err(|e| anyhow::anyhow!("ClientConfig: {e}"))?;
    info!(endpoint = ?cfg.endpoint, "photo: connecting to broker");

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

    // Reset any sync statuses stuck at "syncing" from a previous crash
    use sea_orm::ConnectionTrait;
    db.execute_unprepared("UPDATE photo.photo_libraries SET sync_status = 'idle' WHERE sync_status = 'syncing'")
        .await?;

    // Initialize source registry (VFS drivers for local/NAS/cloud sources)
    let sources = Arc::new(SourceRegistry::new(db.clone()));

    // Initialize storage provider (local filesystem via OpenDAL)
    let storage_slot: Arc<OnceLock<Arc<dyn crate::services::storage::StorageProvider>>> =
        Arc::new(OnceLock::new());
    let storage = crate::services::storage::create_storage_from_env(&data_local_path());
    storage_slot
        .set(storage)
        .map_err(|_| anyhow::anyhow!("storage_slot already set"))?;

    // Load AI settings from DB (may be default if not yet configured)
    let ai_settings: PhotoAiSettings = SystemConfigRepo::get(&db)
        .await
        .unwrap_or_else(|_| PhotoAiSettings::default_value());

    let (event_tx, _) = tokio::sync::broadcast::channel(256);
    let client_slot: Arc<OnceLock<Arc<BusClient>>> = Arc::new(OnceLock::new());

    let ctx = Arc::new(AppState {
        db,
        sources,
        storage: storage_slot,
        http_client: reqwest::Client::new(),
        event_tx,
        job_cancel: crate::state::JobCancelRegistry::new(),
        job_notify: Arc::new(tokio::sync::Notify::new()),
        bus_client: Arc::clone(&client_slot),
        ai: Arc::new(std::sync::RwLock::new(Some(ai_settings))),
        ai_worker: Arc::new(OnceLock::new()),
    });

    // 起 axum router 监听 UDS（业务 + assets + data 都在这个 sock 上）
    let app_socket = app_server::spawn("photo", Arc::clone(&ctx))
        .await
        .map_err(|e| anyhow::anyhow!("app_server spawn: {e}"))?;

    // 把 sock 通过 `data_plane_socket` 上报给 broker
    let builder = BusClient::builder(cfg)
        .service("photo", env!("CARGO_PKG_VERSION"))
        .data_plane(app_socket);
    let builder = bus_services::photo_jobs::register(builder, Arc::clone(&ctx));
    let client = builder.build().await.map_err(|e| anyhow::anyhow!("bus build: {e}"))?;
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
            info!("photo: SIGINT received");
            client.shutdown();
        }
        _ = shutdown => info!("photo: broker sent Shutdown"),
    }

    Ok(())
}
