CREATE TABLE `legacy_restore_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`selected_paths` text NOT NULL,
	`staging_path` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`error_msg` text,
	`restored_file_count` integer,
	`restored_bytes` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`repository_id`) REFERENCES `legacy_repositories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `legacy_restore_jobs_repository_id_idx` ON `legacy_restore_jobs` (`repository_id`);