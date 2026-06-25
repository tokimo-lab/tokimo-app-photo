use chrono::Utc;
use sea_orm::prelude::Expr;
use sea_orm::sea_query::OnConflict;
use sea_orm::*;
use std::collections::HashMap;
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::bus_clients::media_intelligence as media_bus;
use crate::bus_clients::person as person_bus;
use crate::config::PhotoAiSettings;
use crate::db::entities::{photo_faces, photo_persons, photos};
use crate::db::pagination::{Page, PageInput};
use crate::error::AppError;
use crate::error::OptionExt;
use crate::models::{PersonOutput, PhotoFaceOutput, PhotoOutput};

// ── PhotoFaceService ──────────────────────────────────────────────────────

pub struct PhotoFaceService;

impl PhotoFaceService {
    /// Format a 512-d embedding as a pgvector literal: `[0.1,0.2,…]`
    fn vec_literal(embedding: &[f64]) -> String {
        let inner: Vec<String> = embedding.iter().map(std::string::ToString::to_string).collect();
        format!("[{}]", inner.join(","))
    }

    async fn fetch_person_summaries(
        bus_client: Option<&std::sync::Arc<tokimo_bus_client::BusClient>>,
        user_id: Option<Uuid>,
        person_ids: Vec<Uuid>,
    ) -> Result<HashMap<Uuid, person_bus::PersonSummary>, AppError> {
        if person_ids.is_empty() {
            return Ok(HashMap::new());
        }
        let client = bus_client.ok_or_else(|| AppError::Internal("Person service unavailable".into()))?;
        let uid = user_id.ok_or_else(|| AppError::Unauthorized("missing user id".into()))?;
        let persons = person_bus::persons_by_ids(client, person_bus::photo_caller(Some(uid)), person_ids).await?;
        Ok(persons.into_iter().map(|person| (person.id, person)).collect())
    }

    async fn face_ref(
        db: &DatabaseConnection,
        photo_id: Uuid,
        face_id: i32,
    ) -> Result<(photo_faces::Model, i32), AppError> {
        let faces = photo_faces::Entity::find()
            .filter(photo_faces::Column::PhotoId.eq(photo_id))
            .order_by_asc(photo_faces::Column::Id)
            .all(db)
            .await?;
        let (index, face) = faces
            .into_iter()
            .enumerate()
            .find(|(_, face)| face.id == face_id)
            .ok_or_else(|| AppError::NotFound("Face not found".into()))?;
        Ok((face, index as i32))
    }

    async fn ensure_local_person<C: ConnectionTrait>(db: &C, app_id: Uuid, person_id: Uuid) -> Result<(), AppError> {
        let now = Utc::now().fixed_offset();
        let active = photo_persons::ActiveModel {
            id: Set(person_id),
            app_id: Set(app_id),
            name: Set(None),
            face_count: Set(0),
            is_hidden: Set(false),
            created_at: Set(now),
            updated_at: Set(now),
            ..Default::default()
        };
        photo_persons::Entity::insert(active)
            .on_conflict(OnConflict::column(photo_persons::Column::Id).do_nothing().to_owned())
            .exec(db)
            .await?;
        Ok(())
    }

    /// Detect faces in a single photo and store embeddings.
    ///
    /// When `bus_client` and `user_id` are provided, face results are also
    /// registered with the person app via bus for cross-app person matching.
    pub async fn detect_faces(
        db: &DatabaseConnection,
        state: &std::sync::Arc<crate::AppState>,
        photo_id: Uuid,
        bus_client: Option<&std::sync::Arc<tokimo_bus_client::BusClient>>,
        user_id: Option<Uuid>,
    ) -> Result<usize, AppError> {
        let photo = photos::Entity::find_by_id(photo_id)
            .one(db)
            .await?
            .not_found("Photo not found")?;

        let _ = bus_client.ok_or_else(|| AppError::Internal("jobs service unavailable".into()))?;
        let uid = user_id.ok_or_else(|| AppError::Unauthorized("missing user id".into()))?;
        let image_path = photo.thumbnail_path.as_deref().unwrap_or(photo.path.as_str());
        let data = crate::services::media_jobs::create_media_job_and_wait(
            state,
            uid,
            "media_detect_faces_photo",
            serde_json::json!({
                "photoId": photo_id,
                "image": media_bus::image_input_for_photo(&photo, image_path)?,
            }),
        )
        .await?;
        Ok(data.get("faceCount").and_then(|v| v.as_u64()).unwrap_or(0) as usize)
    }

    pub async fn apply_face_detections(
        db: &DatabaseConnection,
        photo_id: Uuid,
        detections: Vec<tokimo_perception::worker::protocol::types::FaceDetection>,
        bus_client: Option<&std::sync::Arc<tokimo_bus_client::BusClient>>,
        user_id: Option<Uuid>,
    ) -> Result<usize, AppError> {
        let photo = photos::Entity::find_by_id(photo_id)
            .one(db)
            .await?
            .not_found("Photo not found")?;
        let count = detections.len();

        if count == 0 {
            return Ok(0);
        }

        // Delete existing faces for this photo before re-inserting
        photo_faces::Entity::delete_many()
            .filter(photo_faces::Column::PhotoId.eq(photo_id))
            .exec(db)
            .await?;

        // Filter to quality-passing faces first, then register those with person app.
        // This ensures face_index in register_faces matches face_index in match_face.
        let quality_faces: Vec<_> = detections
            .iter()
            .filter(|det| {
                let face_size = f64::from(det.w).min(f64::from(det.h));
                f64::from(det.confidence) >= 0.65 && face_size >= 30.0
            })
            .collect();

        let image_hash = photo_id.to_string();
        if let (Some(bc), Some(uid)) = (bus_client, user_id) {
            let face_values: Vec<serde_json::Value> = quality_faces
                .iter()
                .enumerate()
                .map(|(i, det)| {
                    serde_json::json!({
                        "index": i,
                        "x": det.x,
                        "y": det.y,
                        "w": det.w,
                        "h": det.h,
                        "confidence": det.confidence,
                        "embedding": det.embedding,
                    })
                })
                .collect();
            let caller = person_bus::photo_caller(Some(uid));
            // 尝试同步调用，失败时创建 job 异步重试
            if let Err(e) = person_bus::register_faces(
                bc,
                caller.clone(),
                &image_hash,
                "photo",
                &photo_id.to_string(),
                face_values.clone(),
            )
            .await
            {
                warn!("[photo_face] person.register_faces failed for photo {photo_id}, creating retry job: {e}");
                // 创建 job 异步重试，保证最终一致
                if let Err(e2) = person_bus::register_faces_via_job(
                    bc,
                    caller,
                    &image_hash,
                    "photo",
                    &photo_id.to_string(),
                    face_values,
                )
                .await
                {
                    warn!("[photo_face] failed to create retry job for photo {photo_id}: {e2}");
                }
            }
        }

        for (face_index, det) in quality_faces.iter().enumerate() {
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

            let person_id = if let (Some(bc), Some(uid)) = (bus_client, user_id) {
                let caller = person_bus::photo_caller(Some(uid));
                match person_bus::match_face(bc, caller, &image_hash, face_index as i32).await {
                    Ok(resp) => resp.person_id,
                    Err(e) => {
                        warn!(
                            "[photo_face] person.match_face failed for photo {photo_id} face {face_index}: {e}; leaving face unassigned"
                        );
                        None
                    }
                }
            } else {
                None
            };

            if let Some(person_id) = person_id {
                Self::ensure_local_person(db, photo.app_id, person_id).await?;
                let update_sql = "UPDATE photo_faces SET person_id = $1 WHERE id = $2";
                let stmt = Statement::from_sql_and_values(
                    DatabaseBackend::Postgres,
                    update_sql,
                    [person_id.into(), face_id.into()],
                );
                db.execute_raw(stmt).await?;
            }
        }

        Ok(count)
    }

    /// Batch process all unscanned photos in an app.
    /// "Unscanned" = photos with no rows in `photo_faces`.
    pub async fn detect_app(
        db: &DatabaseConnection,
        state: &std::sync::Arc<crate::AppState>,
        app_id: Uuid,
        bus_client: Option<&std::sync::Arc<tokimo_bus_client::BusClient>>,
        user_id: Option<Uuid>,
    ) -> Result<u32, AppError> {
        let pending = Self::list_pending_photo_ids(db, state, app_id).await?;
        if pending.is_empty() {
            return Ok(0);
        }
        let total = pending.len();
        info!("[photo_face] Processing {total} photos for app {app_id}");
        let (success, _, _) = Self::process_photo_ids(db, state, pending, bus_client, user_id).await;
        info!("[photo_face] Done: {success}/{total} photos processed");
        Ok(success)
    }

    /// List photo IDs that still need face detection. Empty Vec when models
    /// are not ready (parent worker treats as no-op).
    pub async fn list_pending_photo_ids(
        db: &DatabaseConnection,
        state: &std::sync::Arc<crate::AppState>,
        app_id: Uuid,
    ) -> Result<Vec<Uuid>, AppError> {
        let settings = PhotoAiSettings::for_app(db, app_id).await?;
        if !settings.face_enabled {
            return Err(AppError::Internal("Face recognition not enabled".into()));
        }
        if !state.is_face_enabled() || !state.models_ready() {
            warn!("[photo_face] Media intelligence service is not ready, skipping batch for app {app_id}");
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
        state: &std::sync::Arc<crate::AppState>,
        ids: Vec<Uuid>,
        bus_client: Option<&std::sync::Arc<tokimo_bus_client::BusClient>>,
        user_id: Option<Uuid>,
    ) -> (u32, u32, Vec<String>) {
        let mut success = 0u32;
        let mut failures = 0u32;
        let mut errors: Vec<String> = Vec::new();
        for photo_id in ids {
            match Self::detect_faces(db, state, photo_id, bus_client, user_id).await {
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

    /// List all persons for an app.
    pub async fn list_persons(
        db: &DatabaseConnection,
        app_id: Uuid,
        bus_client: Option<&std::sync::Arc<tokimo_bus_client::BusClient>>,
        user_id: Option<Uuid>,
    ) -> Result<Vec<PersonOutput>, AppError> {
        let rows = db
            .query_all_raw(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r"
                WITH person_faces AS (
                    SELECT pf.person_id,
                           COUNT(*)::int AS face_count,
                           (ARRAY_AGG(pf.photo_id ORDER BY pf.confidence DESC NULLS LAST, pf.id ASC))[1] AS avatar_photo_id
                    FROM photo_faces pf
                    JOIN photos p ON p.id = pf.photo_id
                    WHERE p.app_id = $1
                      AND p.deleted_at IS NULL
                      AND pf.person_id IS NOT NULL
                    GROUP BY pf.person_id
                )
                SELECT person_id, face_count, avatar_photo_id, p.thumbnail_path as avatar_thumbnail_path
                FROM person_faces
                LEFT JOIN photos p ON p.id = avatar_photo_id
                ORDER BY face_count DESC
                ",
                [app_id.into()],
            ))
            .await?;

        let mut local_rows = Vec::new();
        let mut person_ids = Vec::new();
        for row in rows {
            let person_id = row.try_get::<Uuid>("", "person_id").unwrap_or_default();
            if person_id == Uuid::nil() {
                continue;
            }
            person_ids.push(person_id);
            local_rows.push((
                person_id,
                row.try_get::<i32>("", "face_count").unwrap_or(0),
                row.try_get::<Uuid>("", "avatar_photo_id").ok().map(|u| u.to_string()),
                row.try_get::<Option<String>>("", "avatar_thumbnail_path")
                    .ok()
                    .flatten(),
            ));
        }

        let summaries = Self::fetch_person_summaries(bus_client, user_id, person_ids).await?;
        let persons = local_rows
            .into_iter()
            .filter_map(|(person_id, face_count, avatar_photo_id, avatar_thumbnail_path)| {
                let summary = summaries.get(&person_id)?;
                Some(PersonOutput {
                    id: person_id.to_string(),
                    name: summary.name.clone(),
                    face_count,
                    avatar_photo_id,
                    avatar_thumbnail_path: avatar_thumbnail_path.or_else(|| summary.avatar_url.clone()),
                })
            })
            .collect();

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

    /// Merge two persons in Person, then update the Photo cache for this library.
    pub async fn merge_persons(
        db: &DatabaseConnection,
        app_id: Uuid,
        target_id: Uuid,
        source_id: Uuid,
        bus_client: &std::sync::Arc<tokimo_bus_client::BusClient>,
        user_id: Uuid,
    ) -> Result<(), AppError> {
        person_bus::merge_persons(
            bus_client,
            person_bus::photo_caller(Some(user_id)),
            target_id,
            source_id,
        )
        .await?;

        let stmt = Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r"
            UPDATE photo_faces
            SET person_id = $1
            WHERE person_id = $2
              AND photo_id IN (SELECT id FROM photos WHERE app_id = $3)
            ",
            [target_id.into(), source_id.into(), app_id.into()],
        );
        db.execute_raw(stmt).await?;
        photo_persons::Entity::delete_by_id(source_id).exec(db).await?;
        Ok(())
    }

    /// Rename a person in Person.
    pub async fn rename_person(
        bus_client: &std::sync::Arc<tokimo_bus_client::BusClient>,
        user_id: Uuid,
        person_id: Uuid,
        name: &str,
    ) -> Result<(), AppError> {
        person_bus::update_person(
            bus_client,
            person_bus::photo_caller(Some(user_id)),
            person_id,
            Some(name.to_string()),
            None,
        )
        .await?;
        Ok(())
    }

    /// Assign a face to an existing person.
    ///
    /// If the face was previously assigned to another person, that person's `face_count` is
    /// decremented. The target person's `face_count` is incremented.
    pub async fn assign_face_to_person(
        db: &DatabaseConnection,
        photo_id: Uuid,
        face_id: i32,
        person_id: Uuid,
        bus_client: &std::sync::Arc<tokimo_bus_client::BusClient>,
        user_id: Uuid,
    ) -> Result<(), AppError> {
        let (_face, face_index) = Self::face_ref(db, photo_id, face_id).await?;
        person_bus::assign_face(
            bus_client,
            person_bus::photo_caller(Some(user_id)),
            person_id,
            &photo_id.to_string(),
            face_index,
        )
        .await?;

        let txn = db.begin().await?;
        let face = photo_faces::Entity::find_by_id(face_id)
            .one(&txn)
            .await?
            .not_found("Face not found")?;

        let old_person_id = face.person_id;

        if old_person_id == Some(person_id) {
            Self::recount_person(&txn, person_id).await?;
            txn.commit().await?;
            return Ok(());
        }

        // Update the face's person_id
        let mut active: photo_faces::ActiveModel = face.into();
        active.person_id = Set(Some(person_id));
        active.update(&txn).await?;

        if let Some(old_pid) = old_person_id {
            Self::recount_person(&txn, old_pid).await?;
        }

        Self::recount_person(&txn, person_id).await?;

        txn.commit().await?;
        Ok(())
    }

    /// Create a new person from a face.
    ///
    /// Creates a new person in the same app as the photo, optionally with a name,
    /// and assigns the face to that new person.
    pub async fn create_person_from_face(
        db: &DatabaseConnection,
        photo_id: Uuid,
        face_id: i32,
        name: Option<String>,
        bus_client: &std::sync::Arc<tokimo_bus_client::BusClient>,
        user_id: Uuid,
    ) -> Result<PersonOutput, AppError> {
        let (_face_ref, face_index) = Self::face_ref(db, photo_id, face_id).await?;
        let matched = person_bus::create_person_from_face(
            bus_client,
            person_bus::photo_caller(Some(user_id)),
            name.clone(),
            &photo_id.to_string(),
            face_index,
        )
        .await?;
        let person_id = matched
            .person_id
            .ok_or_else(|| AppError::Internal("person.create_person_from_face returned no person id".into()))?;

        let txn = db.begin().await?;
        let face = photo_faces::Entity::find_by_id(face_id)
            .one(&txn)
            .await?
            .not_found("Face not found")?;

        // Get the photo to determine app_id
        let photo = photos::Entity::find_by_id(face.photo_id)
            .one(&txn)
            .await?
            .not_found("Photo not found")?;

        let old_person_id = face.person_id;
        Self::clear_avatar_face(&txn, face_id).await?;

        let mut active: photo_faces::ActiveModel = face.into();
        active.person_id = Set(Some(person_id));
        active.update(&txn).await?;

        if let Some(old_pid) = old_person_id {
            Self::recount_person(&txn, old_pid).await?;
        }

        txn.commit().await?;
        Ok(PersonOutput {
            id: person_id.to_string(),
            name,
            face_count: 1,
            avatar_photo_id: Some(photo.id.to_string()),
            avatar_thumbnail_path: photo.thumbnail_path.clone(),
        })
    }

    async fn clear_avatar_face<C: ConnectionTrait>(db: &C, face_id: i32) -> Result<(), AppError> {
        photo_persons::Entity::update_many()
            .col_expr(photo_persons::Column::AvatarFaceId, Expr::value(Option::<i32>::None))
            .col_expr(photo_persons::Column::UpdatedAt, Expr::value(Utc::now().fixed_offset()))
            .filter(photo_persons::Column::AvatarFaceId.eq(face_id))
            .exec(db)
            .await?;
        Ok(())
    }

    /// Recount `face_count` for a person and keep its avatar on an owned face.
    async fn recount_person<C: ConnectionTrait>(db: &C, person_id: Uuid) -> Result<(), AppError> {
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

        let avatar_stmt = Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT id FROM photo_faces WHERE person_id = $1 ORDER BY confidence DESC NULLS LAST, id ASC LIMIT 1",
            [person_id.into()],
        );
        let avatar_face_id = db
            .query_one_raw(avatar_stmt)
            .await?
            .and_then(|r| r.try_get::<i32>("", "id").ok());

        if let Some(person) = photo_persons::Entity::find_by_id(person_id).one(db).await? {
            let mut active: photo_persons::ActiveModel = person.into();
            active.face_count = Set(new_count);
            active.avatar_face_id = Set(avatar_face_id);
            active.updated_at = Set(Utc::now().fixed_offset());
            active.update(db).await?;
        }

        Ok(())
    }

    /// Get all detected faces for a specific photo, with person info.
    pub async fn get_photo_faces(
        db: &DatabaseConnection,
        photo_id: Uuid,
        bus_client: Option<&std::sync::Arc<tokimo_bus_client::BusClient>>,
        user_id: Option<Uuid>,
    ) -> Result<Vec<PhotoFaceOutput>, AppError> {
        let rows = db
            .query_all_raw(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r"
                SELECT pf.id, pf.x, pf.y, pf.w, pf.h, pf.confidence,
                       pf.person_id
                FROM photo_faces pf
                WHERE pf.photo_id = $1
                ORDER BY pf.confidence DESC NULLS LAST
                ",
                [photo_id.into()],
            ))
            .await?;

        let mut faces = Vec::new();
        let mut person_ids = Vec::new();
        for row in rows {
            let person_id = row.try_get::<Uuid>("", "person_id").ok();
            if let Some(person_id) = person_id {
                person_ids.push(person_id);
            }
            faces.push(PhotoFaceOutput {
                id: row.try_get::<i32>("", "id").unwrap_or(0),
                x: row.try_get::<f64>("", "x").unwrap_or(0.0),
                y: row.try_get::<f64>("", "y").unwrap_or(0.0),
                w: row.try_get::<f64>("", "w").unwrap_or(0.0),
                h: row.try_get::<f64>("", "h").unwrap_or(0.0),
                confidence: row.try_get::<f64>("", "confidence").ok(),
                person_id: person_id.map(|u| u.to_string()),
                person_name: None,
            });
        }

        person_ids.sort_unstable();
        person_ids.dedup();
        match Self::fetch_person_summaries(bus_client, user_id, person_ids).await {
            Ok(summaries) => {
                for face in &mut faces {
                    let Some(person_id) = face.person_id.as_deref().and_then(|id| Uuid::parse_str(id).ok()) else {
                        continue;
                    };
                    face.person_name = summaries.get(&person_id).and_then(|person| person.name.clone());
                }
            }
            Err(e) => {
                warn!("[photo_face] person summary fetch failed for photo {photo_id}: {e}");
            }
        }

        Ok(faces)
    }
}
