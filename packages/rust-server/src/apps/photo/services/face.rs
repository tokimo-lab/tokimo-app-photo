use chrono::Utc;
use sea_orm::prelude::Expr;
use sea_orm::*;
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::apps::photo::models::{PersonOutput, PhotoFaceOutput, PhotoOutput};
use crate::config::PhotoAiSettings;
use crate::db::entities::{photo_faces, photo_persons, photos};
use crate::db::pagination::{Page, PageInput};
use crate::error::AppError;
use crate::error::OptionExt;

// ── PhotoFaceService ──────────────────────────────────────────────────────

pub struct PhotoFaceService;

impl PhotoFaceService {
    /// Detect faces in an image using the integrated AI service.
    async fn represent(
        ai: &tokimo_perception::worker::client::AiWorkerClient,
        image_bytes: Vec<u8>,
    ) -> Result<Vec<tokimo_perception::worker::protocol::types::FaceDetection>, AppError> {
        ai.detect_faces(image_bytes)
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
        sources: &std::sync::Arc<crate::services::media::source::SourceRegistry>,
        photo_id: Uuid,
    ) -> Result<usize, AppError> {
        let photo = photos::Entity::find_by_id(photo_id)
            .one(db)
            .await?
            .not_found("Photo not found")?;

        let image_path = photo.thumbnail_path.as_deref().unwrap_or(photo.path.as_str());

        let image_bytes = crate::apps::photo::services::ocr::load_photo_bytes(db, sources, &photo, image_path).await?;

        let detections = Self::represent(ai, image_bytes).await?;
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
        sources: &std::sync::Arc<crate::services::media::source::SourceRegistry>,
        app_id: Uuid,
    ) -> Result<u32, AppError> {
        let settings = PhotoAiSettings::for_app(db, app_id).await?;
        if !settings.face_enabled {
            return Err(AppError::Internal("Face recognition not enabled".into()));
        }

        if !ai.is_face_enabled() || !ai.face_models_ready() {
            warn!("[photo_face] Face model files not found, skipping batch for app {app_id}");
            return Ok(0);
        }

        // Find photos that have no face rows yet
        let pending = photos::Entity::find()
            .filter(photos::Column::AppId.eq(app_id))
            .filter(photos::Column::DeletedAt.is_null())
            .filter(Expr::cust(
                "NOT EXISTS (SELECT 1 FROM photo_faces pf WHERE pf.photo_id = photos.id)".to_string(),
            ))
            .all(db)
            .await?;

        let total = pending.len();
        if total == 0 {
            info!("[photo_face] No photos need face detection for app {app_id}");
            return Ok(0);
        }

        info!("[photo_face] Processing {total} photos for app {app_id}");
        let mut success = 0u32;

        for photo in &pending {
            match Self::detect_faces(db, ai, sources, photo.id).await {
                Ok(count) => {
                    success += 1;
                    if count > 0 {
                        info!("[photo_face] {count} faces found in {}", photo.filename);
                    }
                }
                Err(e) => {
                    error!("[photo_face] Failed for {}: {e}", photo.filename);
                }
            }

            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }

        info!("[photo_face] Done: {success}/{total} photos processed");
        Ok(success)
    }

    /// List all persons for an app.
    pub async fn list_persons(db: &DatabaseConnection, app_id: Uuid) -> Result<Vec<PersonOutput>, AppError> {
        let rows = db
            .query_all_raw(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r"
                SELECT pp.id, pp.name, pp.face_count,
                       pf.photo_id as avatar_photo_id,
                       p.thumbnail_path as avatar_thumbnail_path
                FROM photo_persons pp
                LEFT JOIN photo_faces pf ON pf.id = pp.avatar_face_id
                LEFT JOIN photos p ON p.id = pf.photo_id
                WHERE pp.app_id = $1 AND pp.is_hidden = false
                ORDER BY pp.face_count DESC
                ",
                [app_id.into()],
            ))
            .await?;

        let mut persons = Vec::new();
        for row in rows {
            persons.push(PersonOutput {
                id: row.try_get::<Uuid>("", "id").unwrap_or_default().to_string(),
                name: row.try_get("", "name").ok().flatten(),
                face_count: row.try_get::<i32>("", "face_count").unwrap_or(0),
                avatar_photo_id: row.try_get::<Uuid>("", "avatar_photo_id").ok().map(|u| u.to_string()),
                avatar_thumbnail_path: row.try_get("", "avatar_thumbnail_path").ok().flatten(),
            });
        }

        Ok(persons)
    }

    /// Get photos containing a specific person.
    pub async fn photos_by_person(
        db: &DatabaseConnection,
        person_id: Uuid,
        page: &PageInput,
    ) -> Result<Page<PhotoOutput>, AppError> {
        // Count total
        let count_stmt = Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r"
            SELECT COUNT(DISTINCT p.id) as cnt
            FROM photos p
            JOIN photo_faces pf ON pf.photo_id = p.id
            WHERE pf.person_id = $1 AND p.deleted_at IS NULL
            ",
            [person_id.into()],
        );
        let total: i64 = db
            .query_one_raw(count_stmt)
            .await?
            .and_then(|r| r.try_get::<i64>("", "cnt").ok())
            .unwrap_or(0);

        // Fetch photos via join, applying pagination
        let photo_ids_query = photos::Entity::find()
            .filter(photos::Column::DeletedAt.is_null())
            .filter(Expr::cust(format!(
                "photos.id IN (SELECT pf.photo_id FROM photo_faces pf WHERE pf.person_id = '{person_id}')"
            )))
            .order_by_desc(photos::Column::TakenAt)
            .into_partial_model::<PhotoOutput>()
            .paginate(db, page.page_size)
            .fetch_page(page.page.saturating_sub(1))
            .await?;

        Ok(Page::new(photo_ids_query, total, page))
    }

    /// Merge two persons: move all faces from source to target, then delete source.
    pub async fn merge_persons(db: &DatabaseConnection, target_id: Uuid, source_id: Uuid) -> Result<(), AppError> {
        // Move all faces from source → target
        let stmt = Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "UPDATE photo_faces SET person_id = $1 WHERE person_id = $2",
            [target_id.into(), source_id.into()],
        );
        db.execute_raw(stmt).await?;

        // Recount faces for the target person
        let count_stmt = Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT COUNT(*) as cnt FROM photo_faces WHERE person_id = $1",
            [target_id.into()],
        );
        let new_count: i32 = db
            .query_one_raw(count_stmt)
            .await?
            .and_then(|r| r.try_get::<i64>("", "cnt").ok())
            .unwrap_or(0) as i32;

        let target = photo_persons::Entity::find_by_id(target_id).one(db).await?;
        if let Some(t) = target {
            let mut active: photo_persons::ActiveModel = t.into();
            active.face_count = Set(new_count);
            active.updated_at = Set(Utc::now().fixed_offset());
            active.update(db).await?;
        }

        // Delete the source person
        photo_persons::Entity::delete_by_id(source_id).exec(db).await?;

        Ok(())
    }

    /// Rename a person.
    pub async fn rename_person(db: &DatabaseConnection, person_id: Uuid, name: &str) -> Result<(), AppError> {
        let person = photo_persons::Entity::find_by_id(person_id)
            .one(db)
            .await?
            .not_found("Person not found")?;

        let mut active: photo_persons::ActiveModel = person.into();
        active.name = Set(Some(name.to_string()));
        active.updated_at = Set(Utc::now().fixed_offset());
        active.update(db).await?;

        Ok(())
    }

    /// Assign a face to an existing person.
    ///
    /// If the face was previously assigned to another person, that person's `face_count` is
    /// decremented. The target person's `face_count` is incremented.
    pub async fn assign_face_to_person(db: &DatabaseConnection, face_id: i32, person_id: Uuid) -> Result<(), AppError> {
        let face = photo_faces::Entity::find_by_id(face_id)
            .one(db)
            .await?
            .not_found("Face not found")?;

        // Verify target person exists
        let _target = photo_persons::Entity::find_by_id(person_id)
            .one(db)
            .await?
            .not_found("Person not found")?;

        let old_person_id = face.person_id;

        // Update the face's person_id
        let mut active: photo_faces::ActiveModel = face.into();
        active.person_id = Set(Some(person_id));
        active.update(db).await?;

        // Decrement old person's face_count if applicable
        if let Some(old_pid) = old_person_id
            && old_pid != person_id
        {
            Self::recount_person(db, old_pid).await?;
        }

        // Recount target person
        Self::recount_person(db, person_id).await?;

        Ok(())
    }

    /// Create a new person from a face.
    ///
    /// Creates a new person in the same app as the photo, optionally with a name,
    /// and assigns the face to that new person.
    pub async fn create_person_from_face(
        db: &DatabaseConnection,
        face_id: i32,
        name: Option<String>,
    ) -> Result<PersonOutput, AppError> {
        let face = photo_faces::Entity::find_by_id(face_id)
            .one(db)
            .await?
            .not_found("Face not found")?;

        // Get the photo to determine app_id
        let photo = photos::Entity::find_by_id(face.photo_id)
            .one(db)
            .await?
            .not_found("Photo not found")?;

        let old_person_id = face.person_id;

        // Create the new person
        let now = Utc::now().fixed_offset();
        let person_id = Uuid::new_v4();
        let person_model = photo_persons::ActiveModel {
            id: Set(person_id),
            app_id: Set(photo.app_id),
            name: Set(name.clone()),
            avatar_face_id: Set(Some(face_id)),
            face_count: Set(1),
            is_hidden: Set(false),
            created_at: Set(now),
            updated_at: Set(now),
        };
        photo_persons::Entity::insert(person_model).exec(db).await?;

        // Assign the face to the new person
        let mut active: photo_faces::ActiveModel = face.into();
        active.person_id = Set(Some(person_id));
        active.update(db).await?;

        // Decrement old person's face_count if applicable
        if let Some(old_pid) = old_person_id {
            Self::recount_person(db, old_pid).await?;
        }

        Ok(PersonOutput {
            id: person_id.to_string(),
            name,
            face_count: 1,
            avatar_photo_id: Some(photo.id.to_string()),
            avatar_thumbnail_path: photo.thumbnail_path.clone(),
        })
    }

    /// Recount `face_count` for a person and update avatar if needed.
    async fn recount_person(db: &DatabaseConnection, person_id: Uuid) -> Result<(), AppError> {
        let count_stmt = Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT COUNT(*) as cnt FROM photo_faces WHERE person_id = $1",
            [person_id.into()],
        );
        let new_count: i32 = db
            .query_one_raw(count_stmt)
            .await?
            .and_then(|r| r.try_get::<i64>("", "cnt").ok())
            .unwrap_or(0) as i32;

        if let Some(person) = photo_persons::Entity::find_by_id(person_id).one(db).await? {
            let mut active: photo_persons::ActiveModel = person.into();
            active.face_count = Set(new_count);
            active.updated_at = Set(Utc::now().fixed_offset());
            active.update(db).await?;
        }

        Ok(())
    }

    /// Get all detected faces for a specific photo, with person info.
    pub async fn get_photo_faces(db: &DatabaseConnection, photo_id: Uuid) -> Result<Vec<PhotoFaceOutput>, AppError> {
        let rows = db
            .query_all_raw(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r"
                SELECT pf.id, pf.x, pf.y, pf.w, pf.h, pf.confidence,
                       pf.person_id, pp.name as person_name
                FROM photo_faces pf
                LEFT JOIN photo_persons pp ON pp.id = pf.person_id
                WHERE pf.photo_id = $1
                ORDER BY pf.confidence DESC NULLS LAST
                ",
                [photo_id.into()],
            ))
            .await?;

        let mut faces = Vec::new();
        for row in rows {
            faces.push(PhotoFaceOutput {
                id: row.try_get::<i32>("", "id").unwrap_or(0),
                x: row.try_get::<f64>("", "x").unwrap_or(0.0),
                y: row.try_get::<f64>("", "y").unwrap_or(0.0),
                w: row.try_get::<f64>("", "w").unwrap_or(0.0),
                h: row.try_get::<f64>("", "h").unwrap_or(0.0),
                confidence: row.try_get::<f64>("", "confidence").ok(),
                person_id: row.try_get::<Uuid>("", "person_id").ok().map(|u| u.to_string()),
                person_name: row.try_get::<String>("", "person_name").ok(),
            });
        }

        Ok(faces)
    }
}
