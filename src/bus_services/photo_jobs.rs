use std::sync::Arc;

use sea_orm::{ActiveModelTrait, Set};
use serde::Deserialize;
use serde_json::Value as JsonValue;
use tokimo_bus_client::BusClientBuilder;
use tokimo_bus_protocol::{BusError, HttpMethod, MethodDecl};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::AppState;
use crate::bus_clients::media_intelligence as media_bus;
use crate::db::entities::photos;
use crate::services::clip::PhotoClipService;
use crate::services::face::PhotoFaceService;
use crate::services::ocr::PhotoOcrService;

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

fn require_os_caller(caller: &tokimo_bus_protocol::CallerCtx, method: &str) -> Result<(), BusError> {
    if caller.caller_app_id.as_deref() == Some("os") {
        return Ok(());
    }
    Err(BusError::Unauthorized {
        service: "photo".into(),
        method: method.into(),
    })
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApplyMediaResult<T> {
    photo_id: Uuid,
    result: T,
    model_name: Option<String>,
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
    let ctx_apply_ocr = ctx.clone();
    let ctx_apply_face = ctx.clone();
    let ctx_apply_clip = ctx.clone();
    let ctx_apply_gps = ctx.clone();
    let ctx_library_sync = ctx.clone();

    builder
        .method(decl(
            "dispatch_photo_library_sync",
            "Run a photo library sync job",
        ))
        .on_invoke("dispatch_photo_library_sync", move |req| {
            let ctx = ctx_library_sync.clone();
            async move {
                let (job_id, params) = decode_request(&req.payload)?;
                let user_id = caller_user_id(&req.caller);
                let cancel = CancellationToken::new();
                crate::queue::photo_library_sync::handle(&ctx.db, &ctx, job_id, &params, user_id, &cancel)
                    .await
                    .map(|r| serde_json::to_vec(&r).unwrap_or_else(|_| b"{}".to_vec()))
                    .map_err(|e| BusError::Internal(e.to_string()))
            }
        })
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
                crate::queue::handlers::file_scrape::handle(
                    &ctx.db, &ctx, job_id, &params, &cancel, user_id,
                )
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
        .method(decl(
            "dispatch_photo_clip_scan",
            "Run a photo_clip_scan job",
        ))
        .on_invoke("dispatch_photo_clip_scan", move |req| {
            let ctx = ctx_clip_scan.clone();
            async move {
                let (job_id, params) = decode_request(&req.payload)?;
                let user_id = caller_user_id(&req.caller);
                let cancel = CancellationToken::new();
                crate::queue::photo_clip_scan::handle(
                    &ctx.db, &ctx, job_id, &params, user_id, &cancel,
                )
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
        .method(decl(
            "dispatch_photo_clip_single",
            "Run a photo_clip_single job",
        ))
        .on_invoke("dispatch_photo_clip_single", move |req| {
            let ctx = ctx_clip_single.clone();
            async move {
                let (job_id, params) = decode_request(&req.payload)?;
                let user_id = caller_user_id(&req.caller);
                let cancel = CancellationToken::new();
                crate::queue::photo_clip_single::handle(
                    &ctx.db, &ctx, job_id, &params, user_id, &cancel,
                )
                .await
                .map(|r| serde_json::to_vec(&r).unwrap_or_else(|_| b"{}".to_vec()))
                .map_err(|e| BusError::Internal(e.to_string()))
            }
        })
        // ── Face handlers ────────────────────────────────────────────────────
        .method(decl(
            "dispatch_photo_face_scan",
            "Run a photo_face_scan job",
        ))
        .on_invoke("dispatch_photo_face_scan", move |req| {
            let ctx = ctx_face_scan.clone();
            async move {
                let (job_id, params) = decode_request(&req.payload)?;
                let user_id = caller_user_id(&req.caller);
                let cancel = CancellationToken::new();
                crate::queue::photo_face_scan::handle(
                    &ctx.db, &ctx, job_id, &params, user_id, &cancel,
                )
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
        .method(decl(
            "dispatch_photo_face_single",
            "Run a photo_face_single job",
        ))
        .on_invoke("dispatch_photo_face_single", move |req| {
            let ctx = ctx_face_single.clone();
            async move {
                let (job_id, params) = decode_request(&req.payload)?;
                let user_id = caller_user_id(&req.caller);
                let cancel = CancellationToken::new();
                crate::queue::photo_face_single::handle(
                    &ctx.db, &ctx, job_id, &params, user_id, &cancel,
                )
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
                crate::queue::photo_ocr_scan::handle(
                    &ctx.db, &ctx, job_id, &params, user_id, &cancel,
                )
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
        .method(decl(
            "dispatch_photo_ocr_single",
            "Run a photo_ocr_single job",
        ))
        .on_invoke("dispatch_photo_ocr_single", move |req| {
            let ctx = ctx_ocr_single.clone();
            async move {
                let (job_id, params) = decode_request(&req.payload)?;
                let user_id = caller_user_id(&req.caller);
                let cancel = CancellationToken::new();
                crate::queue::photo_ocr_single::handle(
                    &ctx.db, &ctx, job_id, &params, user_id, &cancel,
                )
                .await
                .map(|r| serde_json::to_vec(&r).unwrap_or_else(|_| b"{}".to_vec()))
                .map_err(|e| BusError::Internal(e.to_string()))
            }
        })
        // ── Geocode handlers ─────────────────────────────────────────────────
        .method(decl(
            "dispatch_photo_geocode_scan",
            "Run a photo_geocode_scan job",
        ))
        .on_invoke("dispatch_photo_geocode_scan", move |req| {
            let ctx = ctx_geocode_scan.clone();
            async move {
                let (job_id, params) = decode_request(&req.payload)?;
                let user_id = caller_user_id(&req.caller);
                let cancel = CancellationToken::new();
                crate::queue::photo_geocode_scan::handle(
                    &ctx.db, &ctx, job_id, &params, user_id, &cancel,
                )
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
                crate::queue::photo_geocode::handle(
                    &ctx.db, &ctx, job_id, &params, user_id, &cancel,
                )
                .await
                .map(|r| serde_json::to_vec(&r).unwrap_or_else(|_| b"{}".to_vec()))
                .map_err(|e| BusError::Internal(e.to_string()))
            }
        })
        // ── Media intelligence apply callbacks ──────────────────────────────
        .method(decl(
            "apply_media_ocr_result",
            "Apply OCR result produced by OS media jobs",
        ))
        .on_invoke("apply_media_ocr_result", move |req| {
            let ctx = ctx_apply_ocr.clone();
            async move {
                require_os_caller(&req.caller, "apply_media_ocr_result")?;
                let input: ApplyMediaResult<media_bus::OcrResult> =
                    serde_json::from_slice(&req.payload).map_err(|e| {
                        BusError::BadRequest(format!("apply_media_ocr_result json decode: {e}"))
                    })?;
                let model_name = input
                    .model_name
                    .unwrap_or_else(|| "rapid-ocr-rust".to_string());
                let count = PhotoOcrService::apply_ocr_results(
                    &ctx.db,
                    input.photo_id,
                    model_name,
                    input.result,
                    None,
                )
                .await
                .map_err(|e| BusError::Internal(e.to_string()))?;
                serde_json::to_vec(&serde_json::json!({ "ocrCount": count }))
                    .map_err(|e| BusError::Internal(e.to_string()))
            }
        })
        .method(decl(
            "apply_media_face_result",
            "Apply face detections produced by OS media jobs",
        ))
        .on_invoke("apply_media_face_result", move |req| {
            let ctx = ctx_apply_face.clone();
            async move {
                require_os_caller(&req.caller, "apply_media_face_result")?;
                let input: ApplyMediaResult<media_bus::FaceResult> =
                    serde_json::from_slice(&req.payload).map_err(|e| {
                        BusError::BadRequest(format!("apply_media_face_result json decode: {e}"))
                    })?;
                let detections = input
                    .result
                    .faces
                    .into_iter()
                    .map(
                        |face| tokimo_media_intelligence::worker::protocol::types::FaceDetection {
                            x: face.x,
                            y: face.y,
                            w: face.w,
                            h: face.h,
                            confidence: face.confidence,
                            embedding: face.embedding,
                        },
                    )
                    .collect();
                let count = PhotoFaceService::apply_face_detections(
                    &ctx.db,
                    input.photo_id,
                    detections,
                    ctx.bus_client.get(),
                    caller_user_id(&req.caller),
                )
                .await
                .map_err(|e| BusError::Internal(e.to_string()))?;
                serde_json::to_vec(&serde_json::json!({ "faceCount": count }))
                    .map_err(|e| BusError::Internal(e.to_string()))
            }
        })
        .method(decl(
            "apply_media_clip_result",
            "Apply CLIP embedding produced by OS media jobs",
        ))
        .on_invoke("apply_media_clip_result", move |req| {
            let ctx = ctx_apply_clip.clone();
            async move {
                require_os_caller(&req.caller, "apply_media_clip_result")?;
                let input: ApplyMediaResult<media_bus::ClipResult> =
                    serde_json::from_slice(&req.payload).map_err(|e| {
                        BusError::BadRequest(format!("apply_media_clip_result json decode: {e}"))
                    })?;
                PhotoClipService::apply_clip_embedding(
                    &ctx.db,
                    input.photo_id,
                    input.result.embedding,
                )
                .await
                .map_err(|e| BusError::Internal(e.to_string()))?;
                serde_json::to_vec(&serde_json::json!({ "status": "ok" }))
                    .map_err(|e| BusError::Internal(e.to_string()))
            }
        })
        .method(decl(
            "apply_media_gps_result",
            "Apply GPS result produced by OS media jobs",
        ))
        .on_invoke("apply_media_gps_result", move |req| {
            let ctx = ctx_apply_gps.clone();
            async move {
                require_os_caller(&req.caller, "apply_media_gps_result")?;
                let input: ApplyMediaResult<media_bus::GpsResult> =
                    serde_json::from_slice(&req.payload).map_err(|e| {
                        BusError::BadRequest(format!("apply_media_gps_result json decode: {e}"))
                    })?;
                let active = photos::ActiveModel {
                    id: Set(input.photo_id),
                    gps_latitude: Set(Some(input.result.latitude)),
                    gps_longitude: Set(Some(input.result.longitude)),
                    gps_altitude: Set(input.result.altitude),
                    geo_province: Set(input.result.province),
                    geo_city: Set(input.result.city),
                    geo_district: Set(input.result.district),
                    location_name: Set(input.result.formatted_address.clone()),
                    geo_address: Set(input.result.formatted_address),
                    updated_at: Set(Some(chrono::Utc::now().fixed_offset())),
                    ..Default::default()
                };
                active
                    .update(&ctx.db)
                    .await
                    .map_err(|e| BusError::Internal(e.to_string()))?;
                serde_json::to_vec(&serde_json::json!({ "status": "ok" }))
                    .map_err(|e| BusError::Internal(e.to_string()))
            }
        })
        // ── Capabilities ─────────────────────────────────────────────────────
        .method(decl(
            "capabilities",
            "Return photo bus service capabilities",
        ))
        .on_invoke("capabilities", |_req| async move {
            serde_json::to_vec(&serde_json::json!({
                "version": env!("CARGO_PKG_VERSION"),
                "methods": [
                    "dispatch_photo_library_sync",
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
                    "apply_media_ocr_result",
                    "apply_media_face_result",
                    "apply_media_clip_result",
                    "apply_media_gps_result",
                    "capabilities",
                ],
            }))
            .map_err(|e| BusError::Internal(e.to_string()))
        })
}
