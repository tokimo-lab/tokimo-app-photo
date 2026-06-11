//! 静态资源服务 — rust_embed 嵌入 ui/dist/。

use axum::http::{HeaderValue, header};
use axum::response::{IntoResponse, Response};
use rust_embed::Embed;

#[derive(Embed)]
#[folder = "ui/dist/"]
#[prefix = ""]
struct EmbeddedUi;

#[allow(clippy::collapsible_if)]
pub async fn serve(path: Option<axum::extract::Path<String>>) -> impl IntoResponse {
    let path = path.map(|p| p.0).unwrap_or_default();
    let path = if path.is_empty() || path.ends_with('/') {
        format!("{path}index.html")
    } else {
        path
    };

    let ui_dist_opt = tokimo_bus_cli::manifest::parse_app_ui_dist(crate::MANIFEST)
        .ok()
        .flatten();
    if let Some(ui_dist) = ui_dist_opt.as_deref() {
        let candidate = std::path::Path::new(ui_dist).join(&path);
        if candidate.exists() {
            if let Ok(data) = std::fs::read(&candidate) {
                let mime = mime_from_path(&path);
                return Response::builder()
                    .header(header::CONTENT_TYPE, mime)
                    .header(header::CACHE_CONTROL, "no-store")
                    .body(axum::body::Body::from(data))
                    .unwrap();
            }
        }
    }

    if let Some(content) = EmbeddedUi::get(&path) {
        let mime = mime_from_path(&path);
        Response::builder()
            .header(header::CONTENT_TYPE, mime)
            .header(header::CACHE_CONTROL, "no-store")
            .body(axum::body::Body::from(content.data.to_vec()))
            .unwrap()
    } else {
        Response::builder()
            .status(404)
            .body(axum::body::Body::from("not found"))
            .unwrap()
    }
}

#[allow(clippy::case_sensitive_file_extension_comparisons)]
fn mime_from_path(path: &str) -> HeaderValue {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    let mime = match ext {
        "js" => "application/javascript",
        "css" => "text/css",
        "html" => "text/html; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "woff2" => "font/woff2",
        "json" => "application/json",
        _ => "application/octet-stream",
    };
    HeaderValue::from_static(mime)
}
