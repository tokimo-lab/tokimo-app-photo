//! Library facade — exposes modules for ts-rs type generation and testing.

/// Compile-time embedded app manifest, used by the db module to read the schema name.
pub(crate) const MANIFEST: &str = include_str!("../tokimo-app.toml");

pub mod bus_clients;
pub mod bus_services;
pub mod common;
pub mod config;
pub mod db;
pub mod error;
pub mod handlers;
pub mod models;
pub mod queue;
pub mod repos;
pub mod router;
pub mod services;
pub mod state;

pub use error::AppError;
pub use router::build_photo_app_routes;
pub use state::AppState;
