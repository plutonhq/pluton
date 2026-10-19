-- Additive outcome history; existing restores retain unknown completion/failure fields.
ALTER TABLE persistent_database_restores ADD COLUMN completed_at INTEGER;
--> statement-breakpoint
ALTER TABLE persistent_database_restores ADD COLUMN failure_stage TEXT;
--> statement-breakpoint
ALTER TABLE persistent_database_restores ADD COLUMN failure_code TEXT;
