CREATE TABLE persistent_database_restores (
 id TEXT PRIMARY KEY NOT NULL,
 owner TEXT NOT NULL,
 purpose TEXT NOT NULL CHECK(purpose = 'pluton-persistent-database-restore-v1'),
 plan_id TEXT NOT NULL, repository_id TEXT NOT NULL, backup_id TEXT NOT NULL,
 snapshot_id TEXT NOT NULL CHECK(length(snapshot_id) = 64),
 database_id TEXT NOT NULL, artifact TEXT NOT NULL, metadata_token TEXT NOT NULL,
 mode TEXT NOT NULL CHECK(mode IN ('internal','custom')), target_id TEXT NOT NULL,
 target_fingerprint TEXT, encrypted_approval TEXT, owner_token TEXT NOT NULL,
 database_name TEXT,
 status TEXT NOT NULL CHECK(status IN ('provisioning_required','queued','importing','active','stopped','expired','deleting','cleanup_required','deleted','failed','cancelled')),
 stage TEXT NOT NULL, cleanup TEXT NOT NULL,
 created_at INTEGER NOT NULL, started_at INTEGER, expires_at INTEGER NOT NULL,
 ttl_seconds INTEGER NOT NULL, last_validated_at INTEGER, inspection TEXT, error_code TEXT,
 cancel_requested INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE UNIQUE INDEX persistent_restore_target_reserved ON persistent_database_restores(target_id) WHERE status != 'deleted';
--> statement-breakpoint
CREATE INDEX persistent_restore_status_expiry ON persistent_database_restores(status, expires_at);
--> statement-breakpoint
CREATE UNIQUE INDEX persistent_restore_single_executor ON persistent_database_restores((1)) WHERE status IN ('importing','deleting');
--> statement-breakpoint
CREATE TABLE persistent_restore_import_leases (
 restore_id TEXT PRIMARY KEY NOT NULL REFERENCES persistent_database_restores(id),
 target_id TEXT NOT NULL, database_name TEXT NOT NULL, owner_token TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('intended','created','validated'))
);
--> statement-breakpoint
CREATE TRIGGER persistent_restore_binding_immutable BEFORE UPDATE OF
 owner,purpose,plan_id,repository_id,backup_id,snapshot_id,database_id,artifact,metadata_token,mode,target_id,owner_token
 ON persistent_database_restores
BEGIN SELECT RAISE(ABORT, 'persistent restore binding is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER persistent_restore_history_delete_guard BEFORE DELETE ON persistent_database_restores
 WHEN OLD.status != 'deleted' OR EXISTS (SELECT 1 FROM persistent_restore_import_leases WHERE restore_id=OLD.id)
BEGIN SELECT RAISE(ABORT, 'persistent restore cleanup required'); END;
