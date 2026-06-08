//! Tokimo Photo App — 多进程架构 sidecar binary.

const MANIFEST: &str = include_str!("../tokimo-app.toml");

mod app_server;
mod assets;
mod bus_clients;
mod bus_services;
mod config;
mod ctx;
mod db;
mod error;
mod handlers;
mod models;
mod queue;
mod services;

use std::sync::{Arc, OnceLock};

use tokimo_bus_client::{BusClient, ClientConfig};
use tracing::{error, info};

use crate::services::source::SourceRegistry;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    if std::env::var_os("TOKIMO_BUS_SOCKET").is_some() {
        tracing_subscriber::fmt()
            .with_env_filter(
                tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
                    "info,tokimo_bus_client=info,tokimo_app_photo=debug".into()
                }),
            )
            .init();
        if let Err(error) = run_server().await {
            error!(%error, "photo: fatal");
            std::process::exit(1);
        }
    } else {
        eprintln!("tokimo-app-photo: managed sidecar — set TOKIMO_BUS_SOCKET to run.");
        std::process::exit(0);
    }

    Ok(())
}

async fn run_server() -> anyhow::Result<()> {
    let cfg = ClientConfig::from_env().map_err(|e| anyhow::anyhow!("ClientConfig: {e}"))?;
    info!(endpoint = ?cfg.endpoint, "photo: connecting to broker");

    let db = db::init_pool().await?;
    info!("photo: db connected");

    let ai_settings: crate::config::PhotoAiWorkerSettings =
        crate::db::repos::app_settings_repo::AppSettingsRepo::get(&db)
            .await
            .unwrap_or_default();
    let data_local_path = std::env::var("TOKIMO_DATA_LOCAL_PATH")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from("./.data/local"));
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
    let sources = Arc::new(SourceRegistry::new(Arc::clone(&client_slot)));
    let context = Arc::new(ctx::AppCtx {
        db: db.clone(),
        client: Arc::clone(&client_slot),
        sources,
        ai,
    });

    let app_socket = app_server::spawn("photo", Arc::clone(&context))
        .await
        .map_err(|e| anyhow::anyhow!("app_server spawn: {e}"))?;

    let client = bus_services::photo_jobs::register(
        BusClient::builder(cfg)
            .service("photo", env!("CARGO_PKG_VERSION"))
            .data_plane(app_socket),
        Arc::clone(&context),
    )
    .build()
    .await
    .map_err(|e| anyhow::anyhow!("bus build: {e}"))?;
    client_slot
        .set(Arc::clone(&client))
        .map_err(|_| anyhow::anyhow!("client_slot already set"))?;

    // Register job handlers with the main server (appId inferred from bus caller).
    bus_clients::jobs::register_handler(&client, "photo_clip_scan", "dispatch_photo_clip_scan").await?;
    bus_clients::jobs::register_handler(&client, "photo_clip", "dispatch_photo_clip").await?;
    bus_clients::jobs::register_handler(&client, "photo_clip_single", "dispatch_photo_clip_single").await?;
    bus_clients::jobs::register_handler(&client, "photo_face_scan", "dispatch_photo_face_scan").await?;
    bus_clients::jobs::register_handler(&client, "photo_face", "dispatch_photo_face").await?;
    bus_clients::jobs::register_handler(&client, "photo_face_single", "dispatch_photo_face_single").await?;
    bus_clients::jobs::register_handler(&client, "photo_ocr_scan", "dispatch_photo_ocr_scan").await?;
    bus_clients::jobs::register_handler(&client, "photo_ocr", "dispatch_photo_ocr").await?;
    bus_clients::jobs::register_handler(&client, "photo_ocr_single", "dispatch_photo_ocr_single").await?;
    bus_clients::jobs::register_handler(&client, "photo_geocode_scan", "dispatch_photo_geocode_scan").await?;
    bus_clients::jobs::register_handler(&client, "photo_geocode", "dispatch_photo_geocode").await?;

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
