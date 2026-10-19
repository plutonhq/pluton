CREATE TABLE automatic_recovery_lifecycle (
 id TEXT PRIMARY KEY NOT NULL,
 mode TEXT NOT NULL CHECK(mode IN ('persistent','disposable')),
 binding TEXT NOT NULL,
 owner_token TEXT NOT NULL,
 action TEXT NOT NULL DEFAULT 'provision',
 state TEXT NOT NULL DEFAULT 'requested',
 code TEXT,
 observed_sequence INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX automatic_recovery_one_internal ON automatic_recovery_lifecycle((1)) WHERE state != 'removed';
--> statement-breakpoint
CREATE TRIGGER automatic_recovery_binding_immutable BEFORE UPDATE OF id,mode,binding,owner_token,created_at ON automatic_recovery_lifecycle
BEGIN SELECT RAISE(ABORT,'immutable recovery lifecycle binding'); END;
--> statement-breakpoint
ALTER TABLE recovery_tests ADD COLUMN stage TEXT;
--> statement-breakpoint
CREATE TRIGGER automatic_recovery_test_delete_guard BEFORE DELETE ON recovery_tests
WHEN EXISTS(SELECT 1 FROM automatic_recovery_lifecycle WHERE id=OLD.id AND mode='disposable' AND state!='removed')
BEGIN SELECT RAISE(ABORT,'internal lifecycle cleanup required'); END;
--> statement-breakpoint
CREATE TRIGGER automatic_persistent_delete_guard BEFORE DELETE ON persistent_database_restores
WHEN EXISTS(SELECT 1 FROM automatic_recovery_lifecycle WHERE id=OLD.id AND mode='persistent' AND state!='removed')
BEGIN SELECT RAISE(ABORT,'internal lifecycle cleanup required'); END;
