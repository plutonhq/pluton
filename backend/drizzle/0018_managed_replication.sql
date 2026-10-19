-- Additive server-controlled replication. No secret values or cascading deletion.
CREATE TABLE managed_replication_destinations (
 fingerprint TEXT PRIMARY KEY NOT NULL,
 plan_id TEXT NOT NULL,
 replication_id TEXT NOT NULL,
 source_repository_id TEXT NOT NULL,
 destination_storage_id TEXT NOT NULL,
 destination_storage_path TEXT NOT NULL,
 destination_authority TEXT NOT NULL,
 destination_prefix TEXT NOT NULL,
 init_state TEXT NOT NULL DEFAULT 'uninitialized' CHECK(init_state IN ('uninitialized','initializing','ready','uncertain','detached')),
 actual_repository_id TEXT,
 created_at INTEGER NOT NULL,
 UNIQUE(plan_id,replication_id)
);
--> statement-breakpoint
CREATE TABLE managed_replication_jobs (
 id TEXT PRIMARY KEY NOT NULL,
 backup_id TEXT NOT NULL,
 plan_id TEXT NOT NULL,
 repository_id TEXT NOT NULL,
 agent_id TEXT NOT NULL,
 source_storage_id TEXT NOT NULL,
 source_storage_path TEXT NOT NULL,
 source_snapshot_id TEXT NOT NULL CHECK(length(source_snapshot_id)=64),
 source_repository_config_id TEXT NOT NULL CHECK(length(source_repository_config_id)=64),
 source_tree_id TEXT NOT NULL CHECK(length(source_tree_id)=64),
 source_binding_hash TEXT NOT NULL CHECK(length(source_binding_hash)=64),
 replication_id TEXT NOT NULL,
 destination_storage_id TEXT NOT NULL,
 destination_storage_path TEXT NOT NULL,
 destination_fingerprint TEXT NOT NULL,
 destination_snapshot_id TEXT,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed','uncertain','cancelled')),
 owner_token TEXT,
 attempts INTEGER NOT NULL DEFAULT 0,
 last_error_code TEXT,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 verified_at INTEGER,
 UNIQUE(backup_id,replication_id)
);
--> statement-breakpoint
CREATE INDEX managed_replication_jobs_pending ON managed_replication_jobs(status,created_at);
--> statement-breakpoint
CREATE INDEX managed_replication_jobs_plan ON managed_replication_jobs(plan_id);
--> statement-breakpoint
-- One server replication workload globally. Uncertain execution retains the slot.
CREATE UNIQUE INDEX managed_replication_execution_slot ON managed_replication_jobs((1)) WHERE status IN ('running','uncertain');
--> statement-breakpoint
CREATE TRIGGER managed_replication_plan_delete BEFORE DELETE ON plans
WHEN EXISTS(SELECT 1 FROM managed_replication_jobs WHERE plan_id=OLD.id AND status IN ('pending','running','uncertain'))
BEGIN SELECT RAISE(ABORT,'MANAGED_REPLICATION_BUSY'); END;
--> statement-breakpoint
CREATE TRIGGER managed_replication_backup_delete BEFORE DELETE ON backups
WHEN EXISTS(SELECT 1 FROM managed_replication_jobs WHERE backup_id=OLD.id AND status IN ('pending','running','uncertain'))
BEGIN SELECT RAISE(ABORT,'MANAGED_REPLICATION_BUSY'); END;
--> statement-breakpoint
CREATE TRIGGER managed_replication_plan_binding BEFORE UPDATE OF settings,storage_id,storage_path,source_id,source_type,source_config ON plans
WHEN EXISTS(SELECT 1 FROM managed_replication_jobs WHERE plan_id=OLD.id AND status IN ('pending','running','uncertain'))
BEGIN SELECT RAISE(ABORT,'MANAGED_REPLICATION_BUSY'); END;
--> statement-breakpoint
CREATE TRIGGER managed_replication_storage_binding BEFORE UPDATE OF credentials,settings,type ON storages
WHEN EXISTS(SELECT 1 FROM managed_replication_jobs WHERE (source_storage_id=OLD.id OR destination_storage_id=OLD.id) AND status IN ('pending','running','uncertain'))
BEGIN SELECT RAISE(ABORT,'MANAGED_REPLICATION_BUSY'); END;
--> statement-breakpoint
CREATE TRIGGER managed_replication_storage_delete BEFORE DELETE ON storages
WHEN EXISTS(SELECT 1 FROM managed_replication_jobs WHERE (source_storage_id=OLD.id OR destination_storage_id=OLD.id) AND status IN ('pending','running','uncertain'))
 OR EXISTS(SELECT 1 FROM managed_replication_destinations WHERE destination_storage_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'MANAGED_REPLICATION_BUSY'); END;
