//! Library facade — exposes modules for ts-rs type generation and testing.

/// Compile-time embedded app manifest.
pub const MANIFEST: &str = include_str!("../tokimo-app.toml");

pub mod common;
pub mod config;
pub mod db;
pub mod error;
pub mod handlers;
pub mod models;
pub mod queue;
pub mod router;
pub mod services;
