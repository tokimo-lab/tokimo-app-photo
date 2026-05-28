//! Tokimo Photo App — 多进程架构 sidecar binary.

const MANIFEST: &str = include_str!("../tokimo-app.toml");

mod app_server;
mod assets;
mod bus_clients;
mod bus_services;
mod ctx;
mod db;
mod error;
mod handlers;
mod models;
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

    let client_slot: Arc<OnceLock<Arc<BusClient>>> = Arc::new(OnceLock::new());
    let sources = Arc::new(SourceRegistry::new(Arc::clone(&client_slot)));
    let context = Arc::new(ctx::AppCtx {
        db: db.clone(),
        client: Arc::clone(&client_slot),
        sources,
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
