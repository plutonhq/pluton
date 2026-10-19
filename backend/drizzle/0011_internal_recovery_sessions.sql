CREATE TABLE `internal_recovery_sessions` (
 `id` text PRIMARY KEY NOT NULL,
 `test_id` text NOT NULL REFERENCES `recovery_tests`(`id`) ON DELETE CASCADE,
 `engine` text NOT NULL,
 `installation_id` text NOT NULL,
 `activation_id` text NOT NULL,
 `config` text NOT NULL,
 `encrypted_password` text NOT NULL,
 `ca_sha256` text NOT NULL,
 `cleanup_ready` integer DEFAULT false NOT NULL,
 `released_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `internal_recovery_session_test` ON `internal_recovery_sessions` (`test_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `internal_recovery_session_active` ON `internal_recovery_sessions` ((1)) WHERE released_at IS NULL;
--> statement-breakpoint
CREATE TABLE `internal_recovery_import_leases` (
 `id` text PRIMARY KEY NOT NULL,
 `test_id` text NOT NULL REFERENCES `recovery_tests`(`id`) ON DELETE CASCADE,
 `target_id` text NOT NULL REFERENCES `internal_recovery_sessions`(`id`) ON DELETE CASCADE,
 `database_name` text NOT NULL,
 `owner_token` text NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER `internal_recovery_cleanup_delete_guard` BEFORE DELETE ON `recovery_tests`
WHEN EXISTS (SELECT 1 FROM internal_recovery_sessions WHERE test_id = OLD.id AND released_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'internal recovery cleanup required'); END;
