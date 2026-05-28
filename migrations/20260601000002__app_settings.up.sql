-- Per-sidecar key/value settings table.
--
-- Replaces the host-side `system_config` (scope, scope_id) compound key
-- with a single dotted-key string (e.g. "photo.ai", "photo.geo"). One row per
-- typed settings struct. Value is JSONB; the Rust layer (de)serialises via
-- the `AppSettingsSection` trait.

CREATE TABLE app_settings (
    key         TEXT PRIMARY KEY,
    value       JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
