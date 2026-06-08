//! `photo_jobs` bus service — sidecar-side handler registration.
//!
//! Registers one bus dispatch method per photo queue handler. Each dispatcher
//! decodes the job, creates a per-job [`JobCancel`], spawns a bus cancel poller,
//! installs the [`CurrentJobContext`] task-local via [`cancellation::scope`],
//! invokes the queue handler, aborts the poller, and serializes the result.
//!
//! | bus method                    | inner handler                             |
//! |-------------------------------|-------------------------------------------|
//! | `dispatch_photo_clip_scan`    | `queue::photo_clip_scan::handle`          |
//! | `dispatch_photo_clip`         | `queue::photo_clip::handle`               |
//! | `dispatch_photo_clip_single`  | `queue::photo_clip_single::handle`        |
//! | `dispatch_photo_face_scan`    | `queue::photo_face_scan::handle`          |
//! | `dispatch_photo_face`         | `queue::photo_face::handle`               |
//! | `dispatch_photo_face_single`  | `queue::photo_face_single::handle`        |
//! | `dispatch_photo_ocr_scan`     | `queue::photo_ocr_scan::handle`           |
//! | `dispatch_photo_ocr`          | `queue::photo_ocr::handle`                |
//! | `dispatch_photo_ocr_single`   | `queue::photo_ocr_single::handle`         |
//! | `dispatch_photo_geocode_scan` | `queue::photo_geocode_scan::handle`       |
//! | `dispatch_photo_geocode`      | `queue::photo_geocode::handle`            |
//! | `dispatch_file_scrape`        | `queue::handlers::file_scrape::handle`    |
//! | `capabilities`                | bus capability handshake                  |

use std::sync::Arc;

use serde_json::Value as JsonValue;
use tokimo_bus_client::BusClientBuilder;
use tokimo_bus_protocol::{BusError, HttpMethod, MethodDecl};
use uuid::Uuid;

use crate::ctx::AppCtx;
use crate::queue::cancellation::{self, CurrentJobContext, JobCancel, spawn_cancel_poller};

fn decl(name: &str, description: &str) -> MethodDecl {
    MethodDecl {
        name: name.into(),
        description: Some(description.into()),
        requires_auth: false,
        streaming: false,
        http_method: HttpMethod::Post,
        path: None,
    }
}

/// Extract user_id from CallerCtx (set by host's dispatch).
fn caller_user_id(caller: &tokimo_bus_protocol::CallerCtx) -> Option<Uuid> {
    caller
        .user_id
        .as_deref()
        .and_then(|s| Uuid::parse_str(s).ok())
}

/// Decode `{ "job": { "id": "...", "params": {...} } }` from JSON bytes.
fn decode_request(raw: &[u8]) -> Result<(Uuid, JsonValue), BusError> {
    let v: JsonValue = serde_json::from_slice(raw)
        .map_err(|e| BusError::BadRequest(format!("json decode: {e}")))?;
    let job = v
        .get("job")
        .ok_or_else(|| BusError::BadRequest("missing 'job' field".into()))?;
    let job_id = job
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| BusError::BadRequest("missing 'job.id'".into()))
        .and_then(|s| {
            Uuid::parse_str(s).map_err(|e| BusError::BadRequest(format!("job.id UUID: {e}")))
        })?;
    let params = job.get("params").cloned().unwrap_or(JsonValue::Null);
    Ok((job_id, params))
}

pub fn register(builder: BusClientBuilder, ctx: Arc<AppCtx>) -> BusClientBuilder {
    let ctx_clip_scan = ctx.clone();
    let ctx_clip = ctx.clone();
    let ctx_clip_single = ctx.clone();
    let ctx_face_scan = ctx.clone();
    let ctx_face = ctx.clone();
    let ctx_face_single = ctx.clone();
    let ctx_ocr_scan = ctx.clone();
    let ctx_ocr = ctx.clone();
    let ctx_ocr_single = ctx.clone();
    let ctx_geocode_scan = ctx.clone();
    let ctx_geocode = ctx.clone();
    let ctx_file_scrape = ctx.clone();

    builder
        // ── dispatch_photo_clip_scan ─────────────────────────────────────────
        .method(decl(
            "dispatch_photo_clip_scan",
            "Run a photo_clip_scan job on behalf of the main worker",
        ))
        .on_invoke("dispatch_photo_clip_scan", move |req| {
            let ctx = ctx_clip_scan.clone();
            async move {
                let (job_id, params) = decode_request(&req.payload)?;
                let user_id = caller_user_id(&req.caller);
                let cancel = JobCancel::new();
                let poller = spawn_cancel_poller(ctx.client(), job_id, cancel.clone());
                let cur = CurrentJobContext {
                    job_id,
                    cancel: cancel.clone(),
                };
                let result = cancellation::scope(
                    cur,
                    crate::queue::photo_clip_scan::handle(&ctx, job_id, &params, user_id, &cancel),
                )
                .await;
                poller.abort();
                result
                    .map(|r| serde_json::to_vec(&r).unwrap_or_else(|_| b"{}".to_vec()))
                    .map_err(|e| BusError::Internal(e.to_string()))
            }
        })
        // ── dispatch_photo_clip ──────────────────────────────────────────────
        .method(decl(
            "dispatch_photo_clip",
            "Run a photo_clip job on behalf of the main worker",
        ))
        .on_invoke("dispatch_photo_clip", move |req| {
            let ctx = ctx_clip.clone();
            async move {
                let (job_id, params) = decode_request(&req.payload)?;
                let user_id = caller_user_id(&req.caller);
                let cancel = JobCancel::new();
                let poller = spawn_cancel_poller(ctx.client(), job_id, cancel.clone());
                let cur = CurrentJobContext {
                    job_id,
                    cancel: cancel.clone(),
                };
                let result = cancellation::scope(
                    cur,
                    crate::queue::photo_clip::handle(&ctx, job_id, &params, user_id, &cancel),
                )
                .await;
                poller.abort();
                result
                    .map(|r| serde_json::to_vec(&r).unwrap_or_else(|_| b"{}".to_vec()))
                    .map_err(|e| BusError::Internal(e.to_string()))
            }
        })
        // ── dispatch_photo_clip_single ───────────────────────────────────────
        .method(decl(
            "dispatch_photo_clip_single",
            "Run a photo_clip_single job on behalf of the main worker",
        ))
        .on_invoke("dispatch_photo_clip_single", move |req| {
            let ctx = ctx_clip_single.clone();
            async move {
                let (job_id, params) = decode_request(&req.payload)?;
                let user_id = caller_user_id(&req.caller);
                let cancel = JobCancel::new();
                let poller = spawn_cancel_poller(ctx.client(), job_id, cancel.clone());
                let cur = CurrentJobContext {
                    job_id,
                    cancel: cancel.clone(),
                };
                let result = cancellation::scope(
                    cur,
                    crate::queue::photo_clip_single::handle(
                        &ctx, job_id, &params, user_id, &cancel,
                    ),
                )
                .await;
                poller.abort();
                result
                    .map(|r| serde_json::to_vec(&r).unwrap_or_else(|_| b"{}".to_vec()))
                    .map_err(|e| BusError::Internal(e.to_string()))
            }
        })
        // ── dispatch_photo_face_scan ─────────────────────────────────────────
        .method(decl(
            "dispatch_photo_face_scan",
            "Run a photo_face_scan job on behalf of the main worker",
        ))
        .on_invoke("dispatch_photo_face_scan", move |req| {
            let ctx = ctx_face_scan.clone();
            async move {
                let (job_id, params) = decode_request(&req.payload)?;
                let user_id = caller_user_id(&req.caller);
                let cancel = JobCancel::new();
                let poller = spawn_cancel_poller(ctx.client(), job_id, cancel.clone());
                let cur = CurrentJobContext {
                    job_id,
                    cancel: cancel.clone(),
                };
                let result = cancellation::scope(
                    cur,
                    crate::queue::photo_face_scan::handle(&ctx, job_id, &params, user_id, &cancel),
                )
                .await;
                poller.abort();
                result
                    .map(|r| serde_json::to_vec(&r).unwrap_or_else(|_| b"{}".to_vec()))
                    .map_err(|e| BusError::Internal(e.to_string()))
            }
        })
        // ── dispatch_photo_face ──────────────────────────────────────────────
        .method(decl(
            "dispatch_photo_face",
            "Run a photo_face job on behalf of the main worker",
        ))
        .on_invoke("dispatch_photo_face", move |req| {
            let ctx = ctx_face.clone();
            async move {
                let (job_id, params) = decode_request(&req.payload)?;
                let user_id = caller_user_id(&req.caller);
                let cancel = JobCancel::new();
                let poller = spawn_cancel_poller(ctx.client(), job_id, cancel.clone());
                let cur = CurrentJobContext {
                    job_id,
                    cancel: cancel.clone(),
                };
                let result = cancellation::scope(
                    cur,
                    crate::queue::photo_face::handle(&ctx, job_id, &params, user_id, &cancel),
                )
                .await;
                poller.abort();
                result
                    .map(|r| serde_json::to_vec(&r).unwrap_or_else(|_| b"{}".to_vec()))
                    .map_err(|e| BusError::Internal(e.to_string()))
            }
        })
        // ── dispatch_photo_face_single ───────────────────────────────────────
        .method(decl(
            "dispatch_photo_face_single",
            "Run a photo_face_single job on behalf of the main worker",
        ))
        .on_invoke("dispatch_photo_face_single", move |req| {
            let ctx = ctx_face_single.clone();
            async move {
                let (job_id, params) = decode_request(&req.payload)?;
                let user_id = caller_user_id(&req.caller);
                let cancel = JobCancel::new();
                let poller = spawn_cancel_poller(ctx.client(), job_id, cancel.clone());
                let cur = CurrentJobContext {
                    job_id,
                    cancel: cancel.clone(),
                };
                let result = cancellation::scope(
                    cur,
                    crate::queue::photo_face_single::handle(
                        &ctx, job_id, &params, user_id, &cancel,
                    ),
                )
                .await;
                poller.abort();
                result
                    .map(|r| serde_json::to_vec(&r).unwrap_or_else(|_| b"{}".to_vec()))
                    .map_err(|e| BusError::Internal(e.to_string()))
            }
        })
        // ── dispatch_photo_ocr_scan ──────────────────────────────────────────
        .method(decl(
            "dispatch_photo_ocr_scan",
            "Run a photo_ocr_scan job on behalf of the main worker",
        ))
        .on_invoke("dispatch_photo_ocr_scan", move |req| {
            let ctx = ctx_ocr_scan.clone();
            async move {
                let (job_id, params) = decode_request(&req.payload)?;
                let user_id = caller_user_id(&req.caller);
                let cancel = JobCancel::new();
                let poller = spawn_cancel_poller(ctx.client(), job_id, cancel.clone());
                let cur = CurrentJobContext {
                    job_id,
                    cancel: cancel.clone(),
                };
                let result = cancellation::scope(
                    cur,
                    crate::queue::photo_ocr_scan::handle(&ctx, job_id, &params, user_id, &cancel),
                )
                .await;
                poller.abort();
                result
                    .map(|r| serde_json::to_vec(&r).unwrap_or_else(|_| b"{}".to_vec()))
                    .map_err(|e| BusError::Internal(e.to_string()))
            }
        })
        // ── dispatch_photo_ocr ───────────────────────────────────────────────
        .method(decl(
            "dispatch_photo_ocr",
            "Run a photo_ocr job on behalf of the main worker",
        ))
        .on_invoke("dispatch_photo_ocr", move |req| {
            let ctx = ctx_ocr.clone();
            async move {
                let (job_id, params) = decode_request(&req.payload)?;
                let user_id = caller_user_id(&req.caller);
                let cancel = JobCancel::new();
                let poller = spawn_cancel_poller(ctx.client(), job_id, cancel.clone());
                let cur = CurrentJobContext {
                    job_id,
                    cancel: cancel.clone(),
                };
                let result = cancellation::scope(
                    cur,
                    crate::queue::photo_ocr::handle(&ctx, job_id, &params, user_id, &cancel),
                )
                .await;
                poller.abort();
                result
                    .map(|r| serde_json::to_vec(&r).unwrap_or_else(|_| b"{}".to_vec()))
                    .map_err(|e| BusError::Internal(e.to_string()))
            }
        })
        // ── dispatch_photo_ocr_single ────────────────────────────────────────
        .method(decl(
            "dispatch_photo_ocr_single",
            "Run a photo_ocr_single job on behalf of the main worker",
        ))
        .on_invoke("dispatch_photo_ocr_single", move |req| {
            let ctx = ctx_ocr_single.clone();
            async move {
                let (job_id, params) = decode_request(&req.payload)?;
                let user_id = caller_user_id(&req.caller);
                let cancel = JobCancel::new();
                let poller = spawn_cancel_poller(ctx.client(), job_id, cancel.clone());
                let cur = CurrentJobContext {
                    job_id,
                    cancel: cancel.clone(),
                };
                let result = cancellation::scope(
                    cur,
                    crate::queue::photo_ocr_single::handle(&ctx, job_id, &params, user_id, &cancel),
                )
                .await;
                poller.abort();
                result
                    .map(|r| serde_json::to_vec(&r).unwrap_or_else(|_| b"{}".to_vec()))
                    .map_err(|e| BusError::Internal(e.to_string()))
            }
        })
        // ── dispatch_photo_geocode_scan ──────────────────────────────────────
        .method(decl(
            "dispatch_photo_geocode_scan",
            "Run a photo_geocode_scan job on behalf of the main worker",
        ))
        .on_invoke("dispatch_photo_geocode_scan", move |req| {
            let ctx = ctx_geocode_scan.clone();
            async move {
                let (job_id, params) = decode_request(&req.payload)?;
                let user_id = caller_user_id(&req.caller);
                let cancel = JobCancel::new();
                let poller = spawn_cancel_poller(ctx.client(), job_id, cancel.clone());
                let cur = CurrentJobContext {
                    job_id,
                    cancel: cancel.clone(),
                };
                let result = cancellation::scope(
                    cur,
                    crate::queue::photo_geocode_scan::handle(
                        &ctx, job_id, &params, user_id, &cancel,
                    ),
                )
                .await;
                poller.abort();
                result
                    .map(|r| serde_json::to_vec(&r).unwrap_or_else(|_| b"{}".to_vec()))
                    .map_err(|e| BusError::Internal(e.to_string()))
            }
        })
        // ── dispatch_photo_geocode ───────────────────────────────────────────
        .method(decl(
            "dispatch_photo_geocode",
            "Run a photo_geocode job on behalf of the main worker",
        ))
        .on_invoke("dispatch_photo_geocode", move |req| {
            let ctx = ctx_geocode.clone();
            async move {
                let (job_id, params) = decode_request(&req.payload)?;
                let user_id = caller_user_id(&req.caller);
                let cancel = JobCancel::new();
                let poller = spawn_cancel_poller(ctx.client(), job_id, cancel.clone());
                let cur = CurrentJobContext {
                    job_id,
                    cancel: cancel.clone(),
                };
                let result = cancellation::scope(
                    cur,
                    crate::queue::photo_geocode::handle(&ctx, job_id, &params, user_id, &cancel),
                )
                .await;
                poller.abort();
                result
                    .map(|r| serde_json::to_vec(&r).unwrap_or_else(|_| b"{}".to_vec()))
                    .map_err(|e| BusError::Internal(e.to_string()))
            }
        })
        // ── dispatch_file_scrape ─────────────────────────────────────────────
        .method(decl(
            "dispatch_file_scrape",
            "Run a file_scrape job for photo libraries",
        ))
        .on_invoke("dispatch_file_scrape", move |req| {
            let ctx = ctx_file_scrape.clone();
            async move {
                let (job_id, params) = decode_request(&req.payload)?;
                let user_id = caller_user_id(&req.caller);
                let cancel = JobCancel::new();
                let poller = spawn_cancel_poller(ctx.client(), job_id, cancel.clone());
                let cur = CurrentJobContext {
                    job_id,
                    cancel: cancel.clone(),
                };
                let result = cancellation::scope(
                    cur,
                    crate::queue::handlers::file_scrape::handle(&ctx, job_id, &params, user_id, &cancel),
                )
                .await;
                poller.abort();
                result
                    .map(|r| serde_json::to_vec(&r).unwrap_or_else(|_| b"{}".to_vec()))
                    .map_err(|e| BusError::Internal(e.to_string()))
            }
        })
        // ── capabilities ─────────────────────────────────────────────────────
        .method(decl(
            "capabilities",
            "Return photo bus service capabilities",
        ))
        .on_invoke("capabilities", |_req| async move {
            serde_json::to_vec(&serde_json::json!({
                "version": env!("CARGO_PKG_VERSION"),
                "methods": [
                    "capabilities",
                    "dispatch_photo_clip_scan",
                    "dispatch_photo_clip",
                    "dispatch_photo_clip_single",
                    "dispatch_photo_face_scan",
                    "dispatch_photo_face",
                    "dispatch_photo_face_single",
                    "dispatch_photo_ocr_scan",
                    "dispatch_photo_ocr",
                    "dispatch_photo_ocr_single",
                    "dispatch_photo_geocode_scan",
                    "dispatch_photo_geocode",
                    "dispatch_file_scrape",
                ],
            }))
            .map_err(|e| BusError::Internal(e.to_string()))
        })
}
