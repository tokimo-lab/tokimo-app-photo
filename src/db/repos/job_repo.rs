use chrono::Utc;
use sea_orm::{sea_query::Expr, *};
use serde_json::Value as JsonValue;
use uuid::Uuid;

use crate::db::entities::jobs;
use crate::error::AppError;

pub struct JobRepo;

/// Result of `aggregate_parent_progress`.
#[derive(Debug)]
pub struct AggregatedProgress {
    pub total_children: i64,
    pub done: i64,
    pub successes: i32,
    pub failures: i32,
    pub completed: bool,
}

impl JobRepo {
    /// Create a new job record with status "pending".
    pub async fn create_job<C: ConnectionTrait>(
        db: &C,
        job_type: &str,
        params: JsonValue,
        data: Option<JsonValue>,
        user_id: Option<Uuid>,
    ) -> Result<jobs::Model, AppError> {
        let now = Utc::now().fixed_offset();
        let model = jobs::ActiveModel {
            id: Set(Uuid::new_v4()),
            r#type: Set(job_type.to_string()),
            status: Set("pending".to_string()),
            user_id: Set(user_id),
            app_id: Set(None),
            parent_job_id: Set(None),
            task_type: Set(None),
            params: Set(Some(params)),
            data: Set(data.unwrap_or(JsonValue::Null)),
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
            priority: Set(100),
        };
        Ok(jobs::Entity::insert(model).exec_with_returning(db).await?)
    }

    /// Update job progress and data.
    pub async fn update_progress<C: ConnectionTrait>(
        db: &C,
        id: Uuid,
        progress: i32,
        data: Option<JsonValue>,
    ) -> Result<Option<jobs::Model>, AppError> {
        let mut update = jobs::Entity::update_many()
            .col_expr(jobs::Column::Progress, Expr::value(progress))
            .col_expr(jobs::Column::UpdatedAt, Expr::cust("NOW()"))
            .filter(jobs::Column::Id.eq(id));

        if let Some(m) = data {
            update = update.col_expr(jobs::Column::Data, Expr::value(m));
        }

        let result = update.exec(db).await?;
        if result.rows_affected == 0 {
            return Ok(None);
        }
        Ok(jobs::Entity::find_by_id(id).one(db).await?)
    }

    /// Enqueue with deduplication. Returns (job, alias_target).
    #[allow(clippy::too_many_arguments)]
    pub async fn enqueue_with_dedupe<C: ConnectionTrait>(
        db: &C,
        job_type: &str,
        params: JsonValue,
        data: Option<JsonValue>,
        user_id: Option<Uuid>,
        parent_job_id: Option<Uuid>,
        task_type: Option<String>,
        dedupe_key: Option<String>,
        priority: i32,
    ) -> Result<(jobs::Model, Option<jobs::Model>), AppError> {
        // Check for existing job with same dedupe_key
        if let Some(ref key) = dedupe_key {
            if let Some(existing) = jobs::Entity::find()
                .filter(jobs::Column::DedupeKey.eq(key.as_str()))
                .filter(jobs::Column::Status.is_in(vec!["pending", "running"]))
                .one(db)
                .await?
            {
                return Ok((existing, None));
            }
        }

        let now = Utc::now().fixed_offset();
        let model = jobs::ActiveModel {
            id: Set(Uuid::new_v4()),
            r#type: Set(job_type.to_string()),
            status: Set("pending".to_string()),
            user_id: Set(user_id),
            app_id: Set(None),
            parent_job_id: Set(parent_job_id),
            task_type: Set(task_type),
            params: Set(Some(params)),
            data: Set(data.unwrap_or(JsonValue::Null)),
            progress: Set(0),
            retry_count: Set(0),
            max_retries: Set(3),
            error: Set(None),
            started_at: Set(None),
            completed_at: Set(None),
            created_at: Set(now),
            updated_at: Set(now),
            dedupe_key: Set(dedupe_key),
            alias_job_id: Set(None),
            priority: Set(priority),
        };
        let job = jobs::Entity::insert(model).exec_with_returning(db).await?;
        Ok((job, None))
    }

    /// Create jobs in batch (no parent). Returns count of inserted jobs.
    pub async fn create_jobs_batch<C: ConnectionTrait>(
        db: &C,
        jobs: Vec<(&str, JsonValue, Option<JsonValue>, Option<Uuid>)>,
    ) -> Result<u64, AppError> {
        let now = Utc::now().fixed_offset();
        let mut count = 0u64;
        for (job_type, params, data, user_id) in jobs {
            let model = jobs::ActiveModel {
                id: Set(Uuid::new_v4()),
                r#type: Set(job_type.to_string()),
                status: Set("pending".to_string()),
                user_id: Set(user_id),
                app_id: Set(None),
                parent_job_id: Set(None),
                task_type: Set(None),
                params: Set(Some(params)),
                data: Set(data.unwrap_or(JsonValue::Null)),
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
                priority: Set(100),
            };
            jobs::Entity::insert(model).exec(db).await?;
            count += 1;
        }
        Ok(count)
    }

    /// Create child jobs in batch. Returns count of inserted jobs.
    pub async fn create_child_jobs_batch<C: ConnectionTrait>(
        db: &C,
        children: Vec<(&str, JsonValue, Option<JsonValue>, Option<Uuid>, Uuid, String)>,
        _priority: Option<i32>,
    ) -> Result<u64, AppError> {
        let now = Utc::now().fixed_offset();
        let mut count = 0u64;
        for (job_type, params, data, user_id, parent_job_id, task_type) in children {
            let model = jobs::ActiveModel {
                id: Set(Uuid::new_v4()),
                r#type: Set(job_type.to_string()),
                status: Set("pending".to_string()),
                user_id: Set(user_id),
                app_id: Set(None),
                parent_job_id: Set(Some(parent_job_id)),
                task_type: Set(Some(task_type)),
                params: Set(Some(params)),
                data: Set(data.unwrap_or(JsonValue::Null)),
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
                priority: Set(_priority.unwrap_or(100)),
            };
            jobs::Entity::insert(model).exec(db).await?;
            count += 1;
        }
        Ok(count)
    }

    /// Preempt scan jobs for a given app_id and task_type.
    pub async fn preempt_scans<C: ConnectionTrait>(
        db: &C,
        app_id: Uuid,
        task_type: &str,
        reason: &str,
    ) -> Result<Vec<Uuid>, AppError> {
        let jobs = jobs::Entity::find()
            .filter(jobs::Column::TaskType.eq(task_type))
            .filter(jobs::Column::Status.is_in(vec!["pending", "running", "waiting", "suspended"]))
            .all(db)
            .await?;

        let mut ids = Vec::new();
        for job in jobs {
            // Check if this job's params contain the app_id
            if let Some(params) = &job.params {
                if let Some(lib_id) = params.get("photoLibraryId").and_then(|v| v.as_str()) {
                    if lib_id == app_id.to_string() {
                        ids.push(job.id);
                    }
                }
            }
        }

        if !ids.is_empty() {
            let now = Utc::now().fixed_offset();
            jobs::Entity::update_many()
                .col_expr(jobs::Column::Status, Expr::value("cancelled"))
                .col_expr(jobs::Column::Error, Expr::value(reason))
                .col_expr(jobs::Column::UpdatedAt, Expr::value(now))
                .filter(jobs::Column::Id.is_in(ids.clone()))
                .exec(db)
                .await?;
        }

        Ok(ids)
    }

    /// Cancel children of given parent jobs.
    pub async fn cancel_children_of<C: ConnectionTrait>(
        db: &C,
        parent_ids: &[Uuid],
        reason: &str,
    ) -> Result<Vec<Uuid>, AppError> {
        let children = jobs::Entity::find()
            .filter(jobs::Column::ParentJobId.is_in(parent_ids.to_vec()))
            .filter(jobs::Column::Status.is_in(vec!["pending", "running"]))
            .all(db)
            .await?;

        let ids: Vec<Uuid> = children.iter().map(|j| j.id).collect();

        if !ids.is_empty() {
            let now = Utc::now().fixed_offset();
            jobs::Entity::update_many()
                .col_expr(jobs::Column::Status, Expr::value("cancelled"))
                .col_expr(jobs::Column::Error, Expr::value(reason))
                .col_expr(jobs::Column::UpdatedAt, Expr::value(now))
                .filter(jobs::Column::Id.is_in(ids.clone()))
                .exec(db)
                .await?;
        }

        Ok(ids)
    }

    /// Preempt scan child for a specific photo.
    pub async fn preempt_scan_child_for<C: ConnectionTrait>(
        db: &C,
        task_type: &str,
        photo_id: Uuid,
        reason: &str,
    ) -> Result<Vec<Uuid>, AppError> {
        let jobs = jobs::Entity::find()
            .filter(jobs::Column::TaskType.eq(task_type))
            .filter(jobs::Column::Status.is_in(vec!["pending", "running"]))
            .all(db)
            .await?;

        let mut ids = Vec::new();
        for job in jobs {
            if let Some(params) = &job.params {
                if let Some(pid) = params.get("photoId").and_then(|v| v.as_str()) {
                    if pid == photo_id.to_string() {
                        ids.push(job.id);
                    }
                }
            }
        }

        if !ids.is_empty() {
            let now = Utc::now().fixed_offset();
            jobs::Entity::update_many()
                .col_expr(jobs::Column::Status, Expr::value("cancelled"))
                .col_expr(jobs::Column::Error, Expr::value(reason))
                .col_expr(jobs::Column::UpdatedAt, Expr::value(now))
                .filter(jobs::Column::Id.is_in(ids.clone()))
                .exec(db)
                .await?;
        }

        Ok(ids)
    }

    /// Aggregate progress from children onto parent.
    pub async fn aggregate_parent_progress<C: ConnectionTrait>(
        db: &C,
        parent_id: Uuid,
        pending_success: i32,
        pending_failure: i32,
    ) -> Result<Option<AggregatedProgress>, AppError> {
        let parent = jobs::Entity::find_by_id(parent_id).one(db).await?;
        let Some(parent) = parent else { return Ok(None) };

        let children = jobs::Entity::find()
            .filter(jobs::Column::ParentJobId.eq(parent_id))
            .all(db)
            .await?;

        let total_children = children.len() as i64;
        let done = children.iter().filter(|j| j.status != "pending" && j.status != "running").count() as i64;
        let successes = children.iter().filter(|j| j.status == "completed").count() as i32 + pending_success;
        let failures = children.iter().filter(|j| j.status == "failed").count() as i32 + pending_failure;
        let completed = done >= total_children;

        // Update parent progress
        let progress = if total_children > 0 {
            ((done * 100) / total_children) as i32
        } else {
            0
        };
        let now = Utc::now().fixed_offset();
        let mut update = jobs::ActiveModel {
            id: Set(parent_id),
            progress: Set(progress),
            updated_at: Set(now),
            ..Default::default()
        };
        if completed {
            update.status = Set("completed".to_string());
            update.completed_at = Set(Some(now));
        }
        jobs::Entity::update(update).exec(db).await?;

        Ok(Some(AggregatedProgress {
            total_children,
            done,
            successes,
            failures,
            completed,
        }))
    }

    /// Cancel all jobs for an app_id.
    pub async fn cancel_jobs_by_app_id<C: ConnectionTrait>(
        db: &C,
        app_id: Uuid,
    ) -> Result<u64, AppError> {
        let now = Utc::now().fixed_offset();
        let result = jobs::Entity::update_many()
            .col_expr(jobs::Column::Status, Expr::value("cancelled"))
            .col_expr(jobs::Column::Error, Expr::value("cancelled by app"))
            .col_expr(jobs::Column::UpdatedAt, Expr::value(now))
            .filter(jobs::Column::Status.is_in(vec!["pending", "running", "waiting"]))
            .exec(db)
            .await?;
        Ok(result.rows_affected)
    }

    /// Delete finished jobs for an app_id.
    pub async fn delete_finished_jobs_by_app_id<C: ConnectionTrait>(
        db: &C,
        app_id: Uuid,
    ) -> Result<u64, AppError> {
        let result = jobs::Entity::delete_many()
            .filter(jobs::Column::Status.is_in(vec!["completed", "failed", "cancelled"]))
            .exec(db)
            .await?;
        Ok(result.rows_affected)
    }
}
