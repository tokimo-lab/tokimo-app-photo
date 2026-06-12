//! Photo app — standalone sidecar process with axum + UDS.
//!
//! Startup flow:
//! 1. Connect to broker (for supervisor health check)
//! 2. Start axum router on `<runtime_dir>/apps/photo.sock`
//! 3. Report the socket to broker via `data_plane_socket`
//! 4. Server-side `/api/apps/photo/<rest>` proxies to this socket's `/<rest>`

const MANIFEST: &str = include_str!("../tokimo-app.toml");

mod app_server;
mod assets;
mod common;
mod config;
mod db;
mod error;
mod handlers;
mod models;
mod queue;
mod router;
mod services;

use std::sync::{Arc, OnceLock};

use clap::Parser;
use sea_orm::DatabaseConnection;
use tokimo_bus_cli::TokimoAuthArgs;
use tokimo_bus_client::{BusClient, ClientConfig};
use tracing::{error, info};

use crate::queue::CancellationRegistry;
use crate::services::ai::AiRegistry;
use crate::services::source::SourceRegistry;
use crate::services::storage::{LocalStorage, StorageProvider};

/// Shared application context passed to all handlers via axum State.
pub struct AppCtx {
    pub db: DatabaseConnection,
    pub client: Arc<OnceLock<Arc<BusClient>>>,
    pub sources: SourceRegistry,
    pub storage: Arc<dyn StorageProvider>,
    pub job_cancel: CancellationRegistry,
    pub ai: Arc<AiRegistry>,
}

#[derive(Parser, Debug)]
#[command(
    name = "tokimo-app-photo",
    about = "Photo — Tokimo app CLI",
    long_about = "Photo CLI — manage photo libraries, trigger sync, and run the photo server.\n\nCLI reads/writes the database directly; no main server process needed.",
    term_width = 100
)]
struct Cli {
    #[command(flatten)]
    auth: TokimoAuthArgs,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    if std::env::var_os("TOKIMO_BUS_SOCKET").is_some() {
        // Server mode: launched by supervisor with TOKIMO_BUS_SOCKET injected
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
        // Manual run without args: print help
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

    let client_slot: Arc<OnceLock<Arc<BusClient>>> = Arc::new(OnceLock::new());
    let ctx = Arc::new(AppCtx {
        db: db.clone(),
        client: Arc::clone(&client_slot),
        sources: SourceRegistry::new(db.clone()),
        storage: Arc::new(LocalStorage::new(format!("{data_local}/photo-storage"))),
        job_cancel: CancellationRegistry::default(),
        ai: Arc::new(AiRegistry::default()),
    });

    let app_socket = app_server::spawn("photo", Arc::clone(&ctx))
        .await
        .map_err(|e| anyhow::anyhow!("app_server spawn: {e}"))?;

    let client = BusClient::builder(cfg)
        .service("photo", env!("CARGO_PKG_VERSION"))
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
            info!("photo: SIGINT received");
            client.shutdown();
        }
        _ = shutdown => info!("photo: broker sent Shutdown"),
    }

    Ok(())
}
