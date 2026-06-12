use sea_orm::{ConnectOptions, Database, DatabaseConnection};

pub mod entities;
pub mod models;
pub mod pagination;
pub mod repos;

/// Shared RFC3339 serialization helpers for DB-facing DTO/output conversions.
pub mod datetime {
    use chrono::{DateTime, TimeZone};
    use std::fmt;

    pub trait ApiDateTimeExt {
        type Output;
        fn to_api_datetime(&self) -> Self::Output;
    }

    impl<Tz> ApiDateTimeExt for DateTime<Tz>
    where
        Tz: TimeZone,
        Tz::Offset: fmt::Display,
    {
        type Output = String;
        fn to_api_datetime(&self) -> Self::Output {
            self.to_rfc3339()
        }
    }

    impl<Tz> ApiDateTimeExt for Option<DateTime<Tz>>
    where
        Tz: TimeZone,
        Tz::Offset: fmt::Display,
    {
        type Output = Option<String>;
        fn to_api_datetime(&self) -> Self::Output {
            self.as_ref().map(DateTime::to_rfc3339)
        }
    }

    pub trait OptionalApiDateTimeExt {
        fn to_api_datetime_or_default(&self) -> String;
    }

    impl<Tz> OptionalApiDateTimeExt for Option<DateTime<Tz>>
    where
        Tz: TimeZone,
        Tz::Offset: fmt::Display,
    {
        fn to_api_datetime_or_default(&self) -> String {
            self.as_ref().map(DateTime::to_rfc3339).unwrap_or_default()
        }
    }
}

// Re-export for convenience
pub use datetime::{ApiDateTimeExt, OptionalApiDateTimeExt};

/// Connect to the PostgreSQL database using the schema from the app manifest.
pub async fn init_pool() -> anyhow::Result<DatabaseConnection> {
    let base_url = std::env::var("DATABASE_URL").map_err(|_| anyhow::anyhow!("DATABASE_URL is required"))?;
    let schema = tokimo_bus_cli::manifest::parse_app_schema(crate::MANIFEST)?
        .ok_or_else(|| anyhow::anyhow!("manifest missing [database] schema"))?;

    let sep = if base_url.contains('?') { '&' } else { '?' };
    let url = format!(
        "{base_url}{sep}application_name=tokimo-app-photo\
         &options=-c%20search_path%3D%22{schema}%22%2Cpublic"
    );

    let mut opts = ConnectOptions::new(url);
    opts.max_connections(8).min_connections(2).sqlx_logging(false);

    Ok(Database::connect(opts).await?)
}
