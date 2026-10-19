-- Additive read-query index only; no backup/snapshot records are modified.
CREATE INDEX `backups_plan_history_date_idx` ON `backups`
  (`plan_id`, coalesce(`ended_at`, `started_at`, `created_at`) DESC, `id` DESC);
