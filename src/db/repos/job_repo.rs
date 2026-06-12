use chrono::Utc;
use sea_orm::sea_query::Expr;
use sea_orm::*;
use uuid::Uuid;

use crate::db::entities::jobs;
use crate::error::AppError;

pub struct JobRepo;

impl JobRepo {
    /// Create a new job.
    pub async fn create_job(
        db: &DatabaseConnection,
        job_type: &str,
        app_id: &str,
        user_id: Option<Uuid>,
        params: serde_json::Value,
        parent_job_id: Option<Uuid>,
        task_type: Option<&str>,
        priority: i32,
    ) -> Result<jobs::Model, AppError> {
        let id = Uuid::new_v4();
        let now = Utc::now().fixed_offset();
        let active = jobs::ActiveModel {
            id: Set(id),
            r#type: Set(job_type.to_string()),
            status: Set("pending".to_string()),
            user_id: Set(user_id),
            app_id: Set(Some(app_id.to_string())),
            parent_job_id: Set(parent_job_id),
            task_type: Set(task_type.map(String::from)),
            data: Set(serde_json::json!({})),
            params: Set(Some(params)),
            progress: Set(0),
            retry_count: Set(0),
            max_retries: Set(3),
            error: Set(None),
            started_at: Set(None),
            completed_at: Set(None),
            created_at: Set(now),
            updated_at: Set(now),
            dedupe_key: Set(None),
            alias_job_id: Set(None),
            priority: Set(priority),
        };
        let model = active.insert(db).await?;
        Ok(model)
    }

    /// Enqueue with deduplication — if a job with the same dedupe_key exists, return it.
    pub async fn enqueue_with_dedupe(
        db: &DatabaseConnection,
        job_type: &str,
        app_id: &str,
        user_id: Option<Uuid>,
        params: serde_json::Value,
        parent_job_id: Option<Uuid>,
        task_type: Option<&str>,
        dedupe_key: Option<&str>,
        priority: i32,
    ) -> Result<(jobs::Model, Option<Uuid>), AppError> {
        if let Some(key) = dedupe_key {
            let existing = jobs::Entity::find()
                .filter(jobs::Column::DedupeKey.eq(key))
                .filter(jobs::Column::Status.is_in(vec!["pending", "running"]))
                .one(db)
                .await?;
            if let Some(m) = existing {
                let alias = m.alias_job_id;
                return Ok((m, alias));
            }
        }
        let model = Self::create_job(db, job_type, app_id, user_id, params, parent_job_id, task_type, priority).await?;
        if let Some(key) = dedupe_key {
            let mut active: jobs::ActiveModel = model.clone().into();
            active.dedupe_key = Set(Some(key.to_string()));
            active.update(db).await?;
        }
        Ok((model, None))
    }

    /// Update job progress.
    pub async fn update_progress(
        db: &DatabaseConnection,
        job_id: Uuid,
        progress: i32,
        data: Option<serde_json::Value>,
    ) -> Result<(), AppError> {
        let now = Utc::now().fixed_offset();
        let mut active = jobs::ActiveModel {
            id: Set(job_id),
            ..Default::default()
        };
        active.progress = Set(progress);
        active.updated_at = Set(now);
        if let Some(d) = data {
            active.data = Set(d);
        }
        active.update(db).await?;
        Ok(())
    }

    /// Preempt scans: cancel pending/running parent jobs of the same (app_id, task_type).
    pub async fn preempt_scans(
        db: &DatabaseConnection,
        app_id: Uuid,
        task_type: &str,
        reason: &str,
    ) -> Result<Vec<Uuid>, AppError> {
        let now = Utc::now().fixed_offset();
        let parents: Vec<(Uuid,)> = jobs::Entity::find()
            .filter(jobs::Column::AppId.eq(app_id.to_string()))
            .filter(jobs::Column::TaskType.eq(task_type))
            .filter(jobs::Column::Status.is_in(vec!["pending", "running", "waiting", "suspended"]))
            .filter(jobs::Column::ParentJobId.is_null())
            .select_only()
            .column(jobs::Column::Id)
            .into_tuple()
            .all(db)
            .await?;

        if parents.is_empty() {
            return Ok(vec![]);
        }

        let ids: Vec<Uuid> = parents.into_iter().map(|(id,)| id).collect();
        jobs::Entity::update_many()
            .filter(jobs::Column::Id.is_in(ids.clone()))
            .set(jobs::ActiveModel {
                status: Set("cancelled".to_string()),
                error: Set(Some(reason.to_string())),
                updated_at: Set(now),
                ..Default::default()
            })
            .exec(db)
            .await?;

        Ok(ids)
    }

    /// Cancel children of given parent jobs.
    pub async fn cancel_children_of(
        db: &DatabaseConnection,
        parent_ids: &[Uuid],
        reason: &str,
    ) -> Result<Vec<Uuid>, AppError> {
        let now = Utc::now().fixed_offset();
        let children: Vec<(Uuid,)> = jobs::Entity::find()
            .filter(jobs::Column::ParentJobId.is_in(parent_ids.to_vec()))
            .filter(jobs::Column::Status.is_in(vec!["pending", "running", "waiting"]))
            .select_only()
            .column(jobs::Column::Id)
            .into_tuple()
            .all(db)
            .await?;

        if children.is_empty() {
            return Ok(vec![]);
        }

        let ids: Vec<Uuid> = children.into_iter().map(|(id,)| id).collect();
        jobs::Entity::update_many()
            .filter(jobs::Column::Id.is_in(ids.clone()))
            .set(jobs::ActiveModel {
                status: Set("cancelled".to_string()),
                error: Set(Some(reason.to_string())),
                updated_at: Set(now),
                ..Default::default()
            })
            .exec(db)
            .await?;

        Ok(ids)
    }

    /// Preempt scan children for a specific photo.
    pub async fn preempt_scan_child_for(
        db: &DatabaseConnection,
        task_type: &str,
        photo_id: Uuid,
        reason: &str,
    ) -> Result<usize, AppError> {
        let now = Utc::now().fixed_offset();
        let result = jobs::Entity::update_many()
            .filter(jobs::Column::TaskType.eq(task_type))
            .filter(jobs::Column::Status.is_in(vec!["pending", "running", "waiting"]))
            .filter(Expr::cust_with_values(
                "data->>'photo_id' = $1",
                [photo_id.to_string()],
            ))
            .set(jobs::ActiveModel {
                status: Set("cancelled".to_string()),
                error: Set(Some(reason.to_string())),
                updated_at: Set(now),
                ..Default::default()
            })
            .exec(db)
            .await?;

        Ok(result.rows_affected as usize)
    }

    /// Create child jobs in batch.
    pub async fn create_child_jobs_batch(
        db: &DatabaseConnection,
        children: Vec<(Uuid, String, String, serde_json::Value, i32)>,
        _dedupe_key: Option<&str>,
    ) -> Result<Vec<jobs::Model>, AppError> {
        let now = Utc::now().fixed_offset();
        let mut models = Vec::with_capacity(children.len());
        for (parent_id, job_type, task_type, data, priority) in children {
            let id = Uuid::new_v4();
            let active = jobs::ActiveModel {
                id: Set(id),
                r#type: Set(job_type),
                status: Set("pending".to_string()),
                user_id: Set(None),
                app_id: Set(None),
                parent_job_id: Set(Some(parent_id)),
                task_type: Set(Some(task_type)),
                data: Set(data),
                params: Set(None),
                progress: Set(0),
                retry_count: Set(0),
                max_retries: Set(3),
                error: Set(None),
                started_at: Set(None),
                completed_at: Set(None),
                created_at: Set(now),
                updated_at: Set(now),
                dedupe_key: Set(None),
                alias_job_id: Set(None),
                priority: Set(priority),
            };
            models.push(active);
        }

        let mut result = Vec::with_capacity(models.len());
        for active in models {
            result.push(active.insert(db).await?);
        }
        Ok(result)
    }

    /// Aggregate parent job progress from children.
    pub async fn aggregate_parent_progress(
        db: &DatabaseConnection,
        parent_id: Uuid,
        pending_success: bool,
        _pending_failure: bool,
    ) -> Result<(), AppError> {
        let children: Vec<(String, i32)> = jobs::Entity::find()
            .filter(jobs::Column::ParentJobId.eq(parent_id))
            .select_only()
            .column(jobs::Column::Status)
            .column(jobs::Column::Progress)
            .into_tuple()
            .all(db)
            .await?;

        if children.is_empty() {
            return Ok(());
        }

        let total = children.len() as i32;
        let completed = children.iter().filter(|(s, _)| s == "completed").count() as i32;
        let failed = children.iter().filter(|(s, _)| s == "failed").count() as i32;
        let progress = if total > 0 { (completed * 100) / total } else { 0 };

        let now = Utc::now().fixed_offset();
        let new_status = if pending_success && completed + failed >= total {
            if failed > 0 { "completed_with_errors" } else { "completed" }
        } else {
            "running"
        };

        jobs::Entity::update_many()
            .filter(jobs::Column::Id.eq(parent_id))
            .set(jobs::ActiveModel {
                status: Set(new_status.to_string()),
                progress: Set(progress),
                updated_at: Set(now),
                ..Default::default()
            })
            .exec(db)
            .await?;

        Ok(())
    }
}
