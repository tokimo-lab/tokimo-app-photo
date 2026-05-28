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

fn mime_from_path(path: &str) -> HeaderValue {
    let mime = if path.ends_with(".js") {
        "application/javascript"
    } else if path.ends_with(".css") {
        "text/css"
    } else if path.ends_with(".html") {
        "text/html; charset=utf-8"
    } else if path.ends_with(".svg") {
        "image/svg+xml"
    } else if path.ends_with(".png") {
        "image/png"
    } else if path.ends_with(".woff2") {
        "font/woff2"
    } else if path.ends_with(".json") {
        "application/json"
    } else {
        "application/octet-stream"
    };
    HeaderValue::from_static(mime)
}
