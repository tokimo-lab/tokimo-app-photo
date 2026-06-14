pub mod datetime;
pub mod entities;
pub mod models;
pub mod pagination;
pub mod repos;

pub use datetime::{ApiDateTimeExt, OptionalApiDateTimeExt};

use sea_orm::{ConnectOptions, Database, DatabaseConnection};

/// Compile-time embedded app manifest, used to read the schema name.
/// Defined in lib.rs/main.rs; re-used here via the crate root.
const MANIFEST: &str = crate::MANIFEST;

/// Connect to the host-provided PostgreSQL database.
///
/// Schema name is read from the compile-time embedded `tokimo-app.toml` manifest.
/// The host app process injects `DATABASE_URL` and has already run all schema migrations.
/// This function only connects and sets the `search_path` to this app's schema.
pub async fn init_pool() -> anyhow::Result<DatabaseConnection> {
    let base_url = std::env::var("DATABASE_URL").map_err(|_| anyhow::anyhow!("DATABASE_URL is required"))?;
    let schema = tokimo_bus_cli::manifest::parse_app_schema(MANIFEST)?
        .ok_or_else(|| anyhow::anyhow!("manifest missing [database] schema"))?;

    let sep = if base_url.contains('?') { '&' } else { '?' };
    let url = format!(
        "{base_url}{sep}application_name=tokimo-app-photo\
         &options=-c%20search_path%3D%22{schema}%22%2Cpublic"
    );

    let mut opts = ConnectOptions::new(url);
    opts.max_connections(4).min_connections(1).sqlx_logging(false);

    Ok(Database::connect(opts).await?)
}
