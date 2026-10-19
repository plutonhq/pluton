CREATE TABLE `recovery_import_leases` (
	`id` text PRIMARY KEY NOT NULL,
	`test_id` text NOT NULL,
	`target_id` text NOT NULL,
	`database_name` text NOT NULL,
	`owner_token` text NOT NULL,
	FOREIGN KEY (`test_id`) REFERENCES `recovery_tests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_id`) REFERENCES `recovery_targets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `recovery_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`engine` text NOT NULL,
	`config` text NOT NULL,
	`encrypted_password` text NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recovery_targets_plan_engine` ON `recovery_targets` (`plan_id`,`engine`);--> statement-breakpoint
CREATE TABLE `recovery_test_policies` (
	`plan_id` text PRIMARY KEY NOT NULL,
	`policy` text NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `recovery_tests` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`backup_id` text NOT NULL,
	`repository_id` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`status` text NOT NULL,
	`trigger` text NOT NULL,
	`automation_key` text,
	`policy` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`result` text,
	`failure_stage` text,
	`failure_code` text,
	`warnings` text DEFAULT '[]' NOT NULL,
	`cancel_requested` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`backup_id`) REFERENCES `backups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repository_id`) REFERENCES `remote_managed_repositories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `recovery_tests_backup_created` ON `recovery_tests` (`backup_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `recovery_tests_status` ON `recovery_tests` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `recovery_tests_automation_key` ON `recovery_tests` (`automation_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `recovery_tests_active_plan` ON `recovery_tests` (`plan_id`) WHERE "recovery_tests"."status" in ('queued','running');
--> statement-breakpoint
CREATE TRIGGER recovery_test_binding_insert BEFORE INSERT ON recovery_tests BEGIN
 SELECT CASE WHEN length(NEW.snapshot_id) <> 64 OR NEW.snapshot_id GLOB '*[^a-f0-9]*'
  OR NOT EXISTS (SELECT 1 FROM backups b JOIN remote_managed_repositories r ON r.id = NEW.repository_id
   WHERE b.id = NEW.backup_id AND b.plan_id = NEW.plan_id AND r.plan_id = NEW.plan_id
    AND b.storage_id = r.storage_id AND b.storage_path = r.storage_path
    AND b.status = 'completed' AND COALESCE(b.in_progress,0) = 0
    AND json_extract(b.completion_stats,'$.snapshot_id') = NEW.snapshot_id)
 THEN RAISE(ABORT, 'recovery snapshot binding invalid') END;
END;
--> statement-breakpoint
CREATE TRIGGER recovery_test_binding_immutable BEFORE UPDATE OF plan_id,backup_id,repository_id,snapshot_id ON recovery_tests BEGIN
 SELECT CASE WHEN NEW.plan_id <> OLD.plan_id OR NEW.backup_id <> OLD.backup_id
  OR NEW.repository_id <> OLD.repository_id OR NEW.snapshot_id <> OLD.snapshot_id
 THEN RAISE(ABORT, 'recovery binding is immutable') END;
END;
--> statement-breakpoint
CREATE TRIGGER recovery_plan_delete_guard BEFORE DELETE ON plans BEGIN
 SELECT CASE WHEN EXISTS (SELECT 1 FROM recovery_tests WHERE plan_id = OLD.id AND status IN ('queued','running'))
  OR EXISTS (SELECT 1 FROM recovery_import_leases l JOIN recovery_tests t ON l.test_id = t.id WHERE t.plan_id = OLD.id)
 THEN RAISE(ABORT, 'finish recovery and cleanup before removing plan') END;
 DELETE FROM recovery_targets WHERE plan_id = OLD.id;
 DELETE FROM recovery_test_policies WHERE plan_id = OLD.id;
 DELETE FROM recovery_tests WHERE plan_id = OLD.id;
END;
--> statement-breakpoint
CREATE TRIGGER recovery_backup_delete_guard BEFORE DELETE ON backups BEGIN
 SELECT CASE WHEN EXISTS (SELECT 1 FROM recovery_tests WHERE backup_id = OLD.id AND status IN ('queued','running'))
  OR EXISTS (SELECT 1 FROM recovery_import_leases l JOIN recovery_tests t ON l.test_id = t.id WHERE t.backup_id = OLD.id)
 THEN RAISE(ABORT, 'finish recovery and cleanup before removing backup') END;
 DELETE FROM recovery_tests WHERE backup_id = OLD.id;
END;
--> statement-breakpoint
CREATE TRIGGER recovery_repository_delete_guard BEFORE DELETE ON remote_managed_repositories BEGIN
 SELECT CASE WHEN EXISTS (SELECT 1 FROM recovery_tests WHERE repository_id = OLD.id AND status IN ('queued','running'))
  OR EXISTS (SELECT 1 FROM recovery_import_leases l JOIN recovery_tests t ON l.test_id = t.id WHERE t.repository_id = OLD.id)
 THEN RAISE(ABORT, 'finish recovery and cleanup before removing repository metadata') END;
 DELETE FROM recovery_tests WHERE repository_id = OLD.id;
END;
