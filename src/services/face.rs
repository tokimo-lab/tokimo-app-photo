#![allow(dead_code)]
//! Photo app — face detection & clustering service.
//!
//! Faithful port of the presplit `services/face.rs` (AI-detection surface only;
//! person-management CRUD lives in `PhotoRepo`). Consumers (queue handlers and
//! AI HTTP endpoints) are wired up in commits 3–5; the `#![allow(dead_code)]`
//! above keeps not-yet-called public items quiet until then.

use chrono::Utc;
use sea_orm::prelude::Expr;
use sea_orm::*;
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::config::PhotoAiSettings;
use crate::db::entities::{photo_faces, photo_persons, photos};
use crate::error::AppError;
use crate::error::OptionExt;

// ── PhotoFaceService ──────────────────────────────────────────────────────

pub struct PhotoFaceService;

impl PhotoFaceService {
    /// Detect faces in an image using the integrated AI service.
    async fn represent(
        ai: &tokimo_perception::worker::client::AiWorkerClient,
        image_bytes: Vec<u8>,
        request_id: Option<String>,
    ) -> Result<Vec<tokimo_perception::worker::protocol::types::FaceDetection>, AppError> {
        ai.detect_faces(image_bytes, request_id)
            .await
            .map_err(|e| AppError::Internal(format!("Face detection error: {e}")))
    }

    /// Format a 512-d embedding as a pgvector literal: `[0.1,0.2,…]`
    fn vec_literal(embedding: &[f64]) -> String {
        let inner: Vec<String> = embedding.iter().map(std::string::ToString::to_string).collect();
        format!("[{}]", inner.join(","))
    }

    /// Find the closest person for a given embedding vector using centroid matching.
    ///
    /// Instead of comparing against the single nearest face (which causes chain
    /// drift), we:
    /// 1. Find the top-K nearest faces by vector distance
    /// 2. Group by `person_id` and compute the average similarity per person
    /// 3. Require the average similarity to exceed the threshold
    ///
    /// This prevents chain drift (A→B→C where A and C look nothing alike).
    async fn find_closest_person(
        db: &DatabaseConnection,
        vec_lit: &str,
        app_id: Uuid,
        threshold: f64,
    ) -> Result<Option<Uuid>, AppError> {
        // Step 1: Find the top-50 nearest faces (by cosine distance), scoped to app
        // Step 2: Group by person, average the similarity, require threshold
        let sql = format!(
            r"
            WITH nearest AS (
                SELECT pf.person_id,
                       1 - (pf.vec <=> '{vec_lit}'::vector) AS similarity
                FROM photo_faces pf
                JOIN photos p ON p.id = pf.photo_id
                WHERE pf.person_id IS NOT NULL
                  AND pf.vec IS NOT NULL
                  AND p.app_id = $1
                ORDER BY pf.vec <=> '{vec_lit}'::vector
                LIMIT 50
            )
            SELECT person_id,
                   AVG(similarity) AS avg_sim,
                   MIN(similarity) AS min_sim,
                   COUNT(*)        AS face_count
            FROM nearest
            GROUP BY person_id
            HAVING AVG(similarity) > {threshold}
            ORDER BY AVG(similarity) DESC
            LIMIT 1
            ",
        );

        let stmt = Statement::from_sql_and_values(DatabaseBackend::Postgres, &sql, [app_id.into()]);
        let row = db.query_one_raw(stmt).await?;

        if let Some(row) = row {
            let person_id: Option<Uuid> = row.try_get("", "person_id").ok();
            if let Some(pid) = person_id {
                return Ok(Some(pid));
            }
        }

        Ok(None)
    }

    /// Create a new person for an app.
    async fn create_person(db: &DatabaseConnection, app_id: Uuid) -> Result<Uuid, AppError> {
        let now = Utc::now().fixed_offset();
        let person_id = Uuid::new_v4();
        let model = photo_persons::ActiveModel {
            id: Set(person_id),
            app_id: Set(app_id),
            name: Set(None),
            avatar_face_id: Set(None),
            face_count: Set(0),
            is_hidden: Set(false),
            created_at: Set(now),
            updated_at: Set(now),
        };
        photo_persons::Entity::insert(model).exec(db).await?;
        Ok(person_id)
    }

    /// Increment the `face_count` on a person and set avatar if not yet set.
    async fn increment_person_face_count(
        db: &DatabaseConnection,
        person_id: Uuid,
        face_id: i32,
    ) -> Result<(), AppError> {
        let person = photo_persons::Entity::find_by_id(person_id).one(db).await?;
        if let Some(p) = person {
            let mut active: photo_persons::ActiveModel = p.clone().into();
            active.face_count = Set(p.face_count + 1);
            if p.avatar_face_id.is_none() {
                active.avatar_face_id = Set(Some(face_id));
            }
            active.updated_at = Set(Utc::now().fixed_offset());
            active.update(db).await?;
        }
        Ok(())
    }

    /// Detect faces in a single photo and store embeddings.
    pub async fn detect_faces(
        db: &DatabaseConnection,
        ai: &std::sync::Arc<tokimo_perception::worker::client::AiWorkerClient>,
        sources: &std::sync::Arc<crate::services::source::SourceRegistry>,
        photo_id: Uuid,
    ) -> Result<usize, AppError> {
        let photo = photos::Entity::find_by_id(photo_id)
            .one(db)
            .await?
            .not_found("Photo not found")?;

        let image_path = photo.thumbnail_path.as_deref().unwrap_or(photo.path.as_str());

        let image_bytes = crate::services::ocr::load_photo_bytes(db, sources, &photo, image_path).await?;

        let scope = crate::services::ai::AiCancelScope::start(ai, photo_id);
        let rid = scope.as_ref().map(crate::services::ai::AiCancelScope::request_id_owned);
        let detections = Self::represent(ai, image_bytes, rid).await?;
        drop(scope);
        let count = detections.len();

        if count == 0 {
            return Ok(0);
        }

        // Delete existing faces for this photo before re-inserting
        photo_faces::Entity::delete_many()
            .filter(photo_faces::Column::PhotoId.eq(photo_id))
            .exec(db)
            .await?;

        for det in &detections {
            // Skip low-quality faces: too small or low confidence produce poor embeddings
            let face_size = f64::from(det.w).min(f64::from(det.h));
            if f64::from(det.confidence) < 0.65 || face_size < 30.0 {
                continue;
            }

            let embedding_f64: Vec<f64> = det.embedding.iter().map(|v| f64::from(*v)).collect();
            let vec_lit = Self::vec_literal(&embedding_f64);

            // Insert the face row via raw SQL (pgvector cast)
            let insert_sql = format!(
                r"INSERT INTO photo_faces (photo_id, x, y, w, h, confidence, vec, created_at)
                   VALUES ($1, $2, $3, $4, $5, $6, '{vec_lit}'::vector, NOW())
                   RETURNING id",
            );
            let stmt = Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                &insert_sql,
                [
                    photo_id.into(),
                    f64::from(det.x).into(),
                    f64::from(det.y).into(),
                    f64::from(det.w).into(),
                    f64::from(det.h).into(),
                    f64::from(det.confidence).into(),
                ],
            );
            let row = db.query_one_raw(stmt).await?;
            let face_id: i32 = row.as_ref().and_then(|r| r.try_get::<i32>("", "id").ok()).unwrap_or(0);

            // Assign to existing person or create a new one
            // Threshold 0.68: conservative — prefer splitting over merging
            let person_id = match Self::find_closest_person(db, &vec_lit, photo.app_id, 0.68).await? {
                Some(pid) => pid,
                None => Self::create_person(db, photo.app_id).await?,
            };

            // Link face → person
            let update_sql = "UPDATE photo_faces SET person_id = $1 WHERE id = $2";
            let stmt = Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                update_sql,
                [person_id.into(), face_id.into()],
            );
            db.execute_raw(stmt).await?;

            Self::increment_person_face_count(db, person_id, face_id).await?;
        }

        Ok(count)
    }

    /// Batch process all unscanned photos in an app.
    /// "Unscanned" = photos with no rows in `photo_faces`.
    pub async fn detect_app(
        db: &DatabaseConnection,
        ai: &std::sync::Arc<tokimo_perception::worker::client::AiWorkerClient>,
        sources: &std::sync::Arc<crate::services::source::SourceRegistry>,
        app_id: Uuid,
    ) -> Result<u32, AppError> {
        let pending = Self::list_pending_photo_ids(db, ai, app_id).await?;
        if pending.is_empty() {
            return Ok(0);
        }
        let total = pending.len();
        info!("[photo_face] Processing {total} photos for app {app_id}");
        let (success, _, _) = Self::process_photo_ids(db, ai, sources, pending).await;
        info!("[photo_face] Done: {success}/{total} photos processed");
        Ok(success)
    }

    /// List photo IDs that still need face detection. Empty Vec when models
    /// are not ready (parent worker treats as no-op).
    pub async fn list_pending_photo_ids(
        db: &DatabaseConnection,
        ai: &std::sync::Arc<tokimo_perception::worker::client::AiWorkerClient>,
        app_id: Uuid,
    ) -> Result<Vec<Uuid>, AppError> {
        let settings = PhotoAiSettings::for_app(db, app_id).await?;
        if !settings.face_enabled {
            return Err(AppError::Internal("Face recognition not enabled".into()));
        }
        if !ai.is_face_enabled() || !ai.face_models_ready() {
            warn!("[photo_face] Face model files not found, skipping batch for app {app_id}");
            return Ok(Vec::new());
        }
        let ids = photos::Entity::find()
            .filter(photos::Column::AppId.eq(app_id))
            .filter(photos::Column::DeletedAt.is_null())
            .filter(Expr::cust(
                "NOT EXISTS (SELECT 1 FROM photo_faces pf WHERE pf.photo_id = photos.id)".to_string(),
            ))
            .select_only()
            .column(photos::Column::Id)
            .into_tuple::<Uuid>()
            .all(db)
            .await?;
        Ok(ids)
    }

    /// Process an explicit set of photo IDs (used by child batch jobs).
    pub async fn process_photo_ids(
        db: &DatabaseConnection,
        ai: &std::sync::Arc<tokimo_perception::worker::client::AiWorkerClient>,
        sources: &std::sync::Arc<crate::services::source::SourceRegistry>,
        ids: Vec<Uuid>,
    ) -> (u32, u32, Vec<String>) {
        let mut success = 0u32;
        let mut failures = 0u32;
        let mut errors: Vec<String> = Vec::new();
        for photo_id in ids {
            match Self::detect_faces(db, ai, sources, photo_id).await {
                Ok(_) => success += 1,
                Err(e) => {
                    failures += 1;
                    let msg = format!("{e}");
                    error!("[photo_face] Failed for photo {photo_id}: {msg}");
                    errors.push(msg);
                }
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
        (success, failures, errors)
    }
}
