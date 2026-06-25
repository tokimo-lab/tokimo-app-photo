use serde::{Deserialize, Serialize};
use tokimo_bus_client::BusClient;
use tokimo_bus_protocol::CallerCtx;

use crate::db::entities::photos;
use crate::error::AppError;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ImageInput {
    Vfs {
        source_id: String,
        path: String,
        filename: Option<String>,
    },
    StorageKey {
        key: String,
        filename: Option<String>,
    },
    InlineBase64 {
        data_base64: String,
        filename: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrImageRequest {
    pub image: ImageInput,
    pub request_id: Option<String>,
    pub model_name: Option<String>,
    pub aux_model_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrItem {
    pub text: String,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub w: Option<f64>,
    pub h: Option<f64>,
    pub angle: f64,
    pub score: Option<f64>,
    pub paragraph_id: i32,
    pub char_positions: Option<serde_json::Value>,
    pub positioning_type: String,
    pub corners: Option<Vec<[f64; 2]>>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrResult {
    pub items: Vec<OcrItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FaceDetectRequest {
    pub image: ImageInput,
    pub request_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FaceItem {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
    pub confidence: f32,
    pub embedding: Vec<f32>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FaceResult {
    pub faces: Vec<FaceItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbedImageRequest {
    pub image: ImageInput,
    pub request_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbedTextRequest {
    pub text: String,
    pub request_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassifyVectorRequest {
    pub vector: Vec<f32>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipResult {
    pub embedding: Vec<f32>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpsResult {
    pub latitude: f64,
    pub longitude: f64,
    pub altitude: Option<f64>,
    pub province: Option<String>,
    pub city: Option<String>,
    pub district: Option<String>,
    pub formatted_address: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipTagResult {
    pub category: String,
    pub icon: String,
    pub subcategory: String,
    pub score: f32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipClassifyResult {
    pub tags: Vec<ClipTagResult>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelRequest {
    pub request_id: String,
}

pub fn photo_caller(user_id: uuid::Uuid) -> CallerCtx {
    CallerCtx {
        user_id: Some(user_id.to_string()),
        request_id: uuid::Uuid::new_v4().to_string(),
        workspace: None,
        caller_app_id: Some("photo".to_string()),
    }
}

pub fn image_input_for_photo(photo: &photos::Model, path: &str) -> Result<ImageInput, AppError> {
    if photo.thumbnail_path.as_deref() == Some(path) {
        return Ok(ImageInput::StorageKey {
            key: path.to_string(),
            filename: Some(photo.filename.clone()),
        });
    }

    let source_id = photo
        .source_id
        .ok_or_else(|| AppError::Internal(format!("Photo {} has no source id", photo.id)))?;
    Ok(ImageInput::Vfs {
        source_id: source_id.to_string(),
        path: path.to_string(),
        filename: Some(photo.filename.clone()),
    })
}

pub async fn ocr_image(
    client: &BusClient,
    caller: CallerCtx,
    request: OcrImageRequest,
) -> Result<OcrResult, AppError> {
    invoke_json(client, "ocr_image", caller, &request).await
}

pub async fn detect_faces(
    client: &BusClient,
    caller: CallerCtx,
    request: FaceDetectRequest,
) -> Result<FaceResult, AppError> {
    invoke_json(client, "detect_faces", caller, &request).await
}

pub async fn embed_image(
    client: &BusClient,
    caller: CallerCtx,
    request: EmbedImageRequest,
) -> Result<ClipResult, AppError> {
    invoke_json(client, "embed_image", caller, &request).await
}

pub async fn embed_text(
    client: &BusClient,
    caller: CallerCtx,
    request: EmbedTextRequest,
) -> Result<ClipResult, AppError> {
    invoke_json(client, "embed_text", caller, &request).await
}

pub async fn classify_vector(
    client: &BusClient,
    caller: CallerCtx,
    request: ClassifyVectorRequest,
) -> Result<ClipClassifyResult, AppError> {
    invoke_json(client, "classify_vector", caller, &request).await
}

pub async fn cancel(
    client: &BusClient,
    caller: CallerCtx,
    request_id: String,
) -> Result<(), AppError> {
    let _: serde_json::Value =
        invoke_json(client, "cancel", caller, &CancelRequest { request_id }).await?;
    Ok(())
}

fn decode_json<T: for<'de> Deserialize<'de>>(method: &str, bytes: Vec<u8>) -> Result<T, AppError> {
    serde_json::from_slice(&bytes)
        .map_err(|e| AppError::Internal(format!("media_intelligence.{method} decode: {e}")))
}

async fn invoke_json<TReq, TResp>(
    client: &BusClient,
    method: &str,
    caller: CallerCtx,
    request: &TReq,
) -> Result<TResp, AppError>
where
    TReq: Serialize,
    TResp: for<'de> Deserialize<'de>,
{
    let payload = serde_json::to_vec(request)
        .map_err(|e| AppError::Internal(format!("media_intelligence.{method} encode: {e}")))?;
    let bytes = client
        .invoke("media_intelligence", method, payload, caller)
        .await
        .map_err(|e| AppError::Internal(format!("media_intelligence.{method} via bus: {e}")))?;
    decode_json(method, bytes)
}
