use std::sync::Arc;

use serde_json::Value as JsonValue;
use tokimo_bus_client::BusClientBuilder;
use tokimo_bus_protocol::{BusError, HttpMethod, MethodDecl};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::AppState;

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

fn caller_user_id(caller: &tokimo_bus_protocol::CallerCtx) -> Option<Uuid> {
    caller.user_id.as_deref().and_then(|s| Uuid::parse_str(s).ok())
}

fn decode_request(raw: &[u8]) -> Result<(Uuid, JsonValue), BusError> {
    let v: JsonValue = serde_json::from_slice(raw).map_err(|e| BusError::BadRequest(format!("json decode: {e}")))?;
    let job = v
        .get("job")
        .ok_or_else(|| BusError::BadRequest("missing 'job' field".into()))?;
    let job_id = job
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| BusError::BadRequest("missing 'job.id'".into()))
        .and_then(|s| Uuid::parse_str(s).map_err(|e| BusError::BadRequest(format!("job.id UUID: {e}"))))?;
    let params = job.get("params").cloned().unwrap_or(JsonValue::Null);
    Ok((job_id, params))
}

pub fn register(builder: BusClientBuilder, ctx: Arc<AppState>) -> BusClientBuilder {
    let ctx_file = ctx.clone();
    let ctx_delete_source = ctx.clone();
    let ctx_register_faces = ctx.clone();
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

    builder
        .method(decl(
            "dispatch_file_scrape",
            "Run a file_scrape job on behalf of the main worker",
        ))
        .on_invoke("dispatch_file_scrape", move |req| {
            let ctx = ctx_file.clone();
            async move {
                let (job_id, params) = decode_request(&req.payload)?;
                let user_id = caller_user_id(&req.caller);
                let cancel = CancellationToken::new();
                crate::queue::handlers::file_scrape::handle(&ctx.db, &ctx, job_id, &params, &cancel, user_id)
                    .await
                    .map(|_| b"{}".to_vec())
                    .map_err(|e| BusError::Internal(e.to_string()))
            }
        })
        .method(decl(
            "dispatch_person_sync_delete_source",
            "Job handler: sync delete source with person app (with retry)",
        ))
        .on_invoke("dispatch_person_sync_delete_source", move |req| {
            let ctx = ctx_delete_source.clone();
            async move {
                let (job_id, params) = decode_request(&req.payload)?;
                let user_id = caller_user_id(&req.caller);
                let cancel = CancellationToken::new();
                crate::queue::person_sync::handle_delete_source(
                    &ctx.db, &ctx, job_id, &params, user_id, &cancel,
                )
                .await
                .map(|_| b"{}".to_vec())
                .map_err(|e| BusError::Internal(e.to_string()))
            }
        })
        .method(decl(
            "dispatch_person_sync_register_faces",
            "Job handler: sync register faces with person app (with retry)",
        ))
        .on_invoke("dispatch_person_sync_register_faces", move |req| {
            let ctx = ctx_register_faces.clone();
            async move {
                let (job_id, params) = decode_request(&req.payload)?;
                let user_id = caller_user_id(&req.caller);
                let cancel = CancellationToken::new();
                crate::queue::person_sync::handle_register_faces(
                    &ctx.db, &ctx, job_id, &params, user_id, &cancel,
                )
                .await
                .map(|_| b"{}".to_vec())
                .map_err(|e| BusError::Internal(e.to_string()))
            }
        })
        // ── CLIP handlers ────────────────────────────────────────────────────
        .method(decl("dispatch_photo_clip_scan", "Run a photo_clip_scan job"))
        .on_invoke("dispatch_photo_clip_scan", move |req| {
            let ctx = ctx_clip_scan.clone();
            async move {
                let (job_id, params) = decode_request(&req.payload)?;
                let user_id = caller_user_id(&req.caller);
                let cancel = CancellationToken::new();
                crate::queue::photo_clip_scan::handle(&ctx.db, &ctx, job_id, &params, user_id, &cancel)
                    .await
                    .map(|r| serde_json::to_vec(&r).unwrap_or_else(|_| b"{}".to_vec()))
                    .map_err(|e| BusError::Internal(e.to_string()))
            }
        })
        .method(decl("dispatch_photo_clip", "Run a photo_clip job"))
        .on_invoke("dispatch_photo_clip", move |req| {
            let ctx = ctx_clip.clone();
            async move {
                let (job_id, params) = decode_request(&req.payload)?;
                let user_id = caller_user_id(&req.caller);
                let cancel = CancellationToken::new();
                crate::queue::photo_clip::handle(&ctx.db, &ctx, job_id, &params, user_id, &cancel)
                    .await
                    .map(|r| serde_json::to_vec(&r).unwrap_or_else(|_| b"{}".to_vec()))
                    .map_err(|e| BusError::Internal(e.to_string()))
            }
        })
        .method(decl("dispatch_photo_clip_single", "Run a photo_clip_single job"))
        .on_invoke("dispatch_photo_clip_single", move |req| {
            let ctx = ctx_clip_single.clone();
            async move {
                let (job_id, params) = decode_request(&req.payload)?;
                let user_id = caller_user_id(&req.caller);
                let cancel = CancellationToken::new();
                crate::queue::photo_clip_single::handle(&ctx.db, &ctx, job_id, &params, user_id, &cancel)
                    .await
                    .map(|r| serde_json::to_vec(&r).unwrap_or_else(|_| b"{}".to_vec()))
                    .map_err(|e| BusError::Internal(e.to_string()))
            }
        })
        // ── Face handlers ────────────────────────────────────────────────────
        .method(decl("dispatch_photo_face_scan", "Run a photo_face_scan job"))
        .on_invoke("dispatch_photo_face_scan", move |req| {
            let ctx = ctx_face_scan.clone();
            async move {
                let (job_id, params) = decode_request(&req.payload)?;
                let user_id = caller_user_id(&req.caller);
                let cancel = CancellationToken::new();
                crate::queue::photo_face_scan::handle(&ctx.db, &ctx, job_id, &params, user_id, &cancel)
                    .await
                    .map(|r| serde_json::to_vec(&r).unwrap_or_else(|_| b"{}".to_vec()))
                    .map_err(|e| BusError::Internal(e.to_string()))
            }
        })
        .method(decl("dispatch_photo_face", "Run a photo_face job"))
        .on_invoke("dispatch_photo_face", move |req| {
            let ctx = ctx_face.clone();
            async move {
                let (job_id, params) = decode_request(&req.payload)?;
                let user_id = caller_user_id(&req.caller);
                let cancel = CancellationToken::new();
                crate::queue::photo_face::handle(&ctx.db, &ctx, job_id, &params, user_id, &cancel)
                    .await
                    .map(|r| serde_json::to_vec(&r).unwrap_or_else(|_| b"{}".to_vec()))
                    .map_err(|e| BusError::Internal(e.to_string()))
            }
        })
        .method(decl("dispatch_photo_face_single", "Run a photo_face_single job"))
        .on_invoke("dispatch_photo_face_single", move |req| {
            let ctx = ctx_face_single.clone();
            async move {
                let (job_id, params) = decode_request(&req.payload)?;
                let user_id = caller_user_id(&req.caller);
                let cancel = CancellationToken::new();
                crate::queue::photo_face_single::handle(&ctx.db, &ctx, job_id, &params, user_id, &cancel)
                    .await
                    .map(|r| serde_json::to_vec(&r).unwrap_or_else(|_| b"{}".to_vec()))
                    .map_err(|e| BusError::Internal(e.to_string()))
            }
        })
        // ── OCR handlers ─────────────────────────────────────────────────────
        .method(decl("dispatch_photo_ocr_scan", "Run a photo_ocr_scan job"))
        .on_invoke("dispatch_photo_ocr_scan", move |req| {
            let ctx = ctx_ocr_scan.clone();
            async move {
                let (job_id, params) = decode_request(&req.payload)?;
                let user_id = caller_user_id(&req.caller);
                let cancel = CancellationToken::new();
                crate::queue::photo_ocr_scan::handle(&ctx.db, &ctx, job_id, &params, user_id, &cancel)
                    .await
                    .map(|r| serde_json::to_vec(&r).unwrap_or_else(|_| b"{}".to_vec()))
                    .map_err(|e| BusError::Internal(e.to_string()))
            }
        })
        .method(decl("dispatch_photo_ocr", "Run a photo_ocr job"))
        .on_invoke("dispatch_photo_ocr", move |req| {
            let ctx = ctx_ocr.clone();
            async move {
                let (job_id, params) = decode_request(&req.payload)?;
                let user_id = caller_user_id(&req.caller);
                let cancel = CancellationToken::new();
                crate::queue::photo_ocr::handle(&ctx.db, &ctx, job_id, &params, user_id, &cancel)
                    .await
                    .map(|r| serde_json::to_vec(&r).unwrap_or_else(|_| b"{}".to_vec()))
                    .map_err(|e| BusError::Internal(e.to_string()))
            }
        })
        .method(decl("dispatch_photo_ocr_single", "Run a photo_ocr_single job"))
        .on_invoke("dispatch_photo_ocr_single", move |req| {
            let ctx = ctx_ocr_single.clone();
            async move {
                let (job_id, params) = decode_request(&req.payload)?;
                let user_id = caller_user_id(&req.caller);
                let cancel = CancellationToken::new();
                crate::queue::photo_ocr_single::handle(&ctx.db, &ctx, job_id, &params, user_id, &cancel)
                    .await
                    .map(|r| serde_json::to_vec(&r).unwrap_or_else(|_| b"{}".to_vec()))
                    .map_err(|e| BusError::Internal(e.to_string()))
            }
        })
        // ── Geocode handlers ─────────────────────────────────────────────────
        .method(decl("dispatch_photo_geocode_scan", "Run a photo_geocode_scan job"))
        .on_invoke("dispatch_photo_geocode_scan", move |req| {
            let ctx = ctx_geocode_scan.clone();
            async move {
                let (job_id, params) = decode_request(&req.payload)?;
                let user_id = caller_user_id(&req.caller);
                let cancel = CancellationToken::new();
                crate::queue::photo_geocode_scan::handle(&ctx.db, &ctx, job_id, &params, user_id, &cancel)
                    .await
                    .map(|r| serde_json::to_vec(&r).unwrap_or_else(|_| b"{}".to_vec()))
                    .map_err(|e| BusError::Internal(e.to_string()))
            }
        })
        .method(decl("dispatch_photo_geocode", "Run a photo_geocode job"))
        .on_invoke("dispatch_photo_geocode", move |req| {
            let ctx = ctx_geocode.clone();
            async move {
                let (job_id, params) = decode_request(&req.payload)?;
                let user_id = caller_user_id(&req.caller);
                let cancel = CancellationToken::new();
                crate::queue::photo_geocode::handle(&ctx.db, &ctx, job_id, &params, user_id, &cancel)
                    .await
                    .map(|r| serde_json::to_vec(&r).unwrap_or_else(|_| b"{}".to_vec()))
                    .map_err(|e| BusError::Internal(e.to_string()))
            }
        })
        // ── Capabilities ─────────────────────────────────────────────────────
        .method(decl("capabilities", "Return photo bus service capabilities"))
        .on_invoke("capabilities", |_req| async move {
            serde_json::to_vec(&serde_json::json!({
                "version": env!("CARGO_PKG_VERSION"),
                "methods": [
                    "dispatch_file_scrape",
                    "dispatch_person_sync_delete_source",
                    "dispatch_person_sync_register_faces",
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
                    "capabilities",
                ],
            }))
            .map_err(|e| BusError::Internal(e.to_string()))
        })
}
