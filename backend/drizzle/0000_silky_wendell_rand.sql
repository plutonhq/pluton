CREATE TABLE `backups` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer,
	`started_at` integer,
	`ended_at` integer,
	`in_progress` integer,
	`success` integer,
	`active` integer DEFAULT true,
	`status` text,
	`error_msg` text,
	`plan_id` text,
	`storage_id` text,
	`storage_path` text,
	`source_id` text NOT NULL,
	`method` text NOT NULL,
	`source_type` text DEFAULT 'device' NOT NULL,
	`source_config` text,
	`encryption` integer DEFAULT true,
	`compression` integer DEFAULT false,
	`download` text,
	`task_stats` text,
	`progress_stats` text,
	`completion_stats` text,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`storage_id`) REFERENCES `storages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'device' NOT NULL,
	`ip` text,
	`host` text,
	`port` integer,
	`key` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer,
	`agent_id` text,
	`versions` text,
	`hostname` text,
	`os` text,
	`platform` text,
	`metrics` text,
	`status` text,
	`tags` text,
	`last_seen` integer,
	`settings` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `devices_agent_id_unique` ON `devices` (`agent_id`);--> statement-breakpoint
CREATE TABLE `plans` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`title` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`in_progress` integer,
	`updated_at` integer,
	`storage_id` text,
	`storage_path` text,
	`source_id` text NOT NULL,
	`source_type` text DEFAULT 'device' NOT NULL,
	`source_config` text NOT NULL,
	`verified` text,
	`last_backup_time` integer,
	`method` text DEFAULT 'backup' NOT NULL,
	`tags` text,
	`settings` text NOT NULL,
	`stats` text,
	FOREIGN KEY (`storage_id`) REFERENCES `storages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `restores` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer,
	`started_at` integer,
	`ended_at` integer,
	`in_progress` integer,
	`status` text,
	`error_msg` text,
	`backup_id` text,
	`plan_id` text,
	`storage_id` text,
	`source_id` text NOT NULL,
	`source_type` text DEFAULT 'device' NOT NULL,
	`config` text,
	`method` text DEFAULT 'backup' NOT NULL,
	`task_stats` text,
	`progress_stats` text,
	`completion_stats` text,
	FOREIGN KEY (`backup_id`) REFERENCES `backups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`storage_id`) REFERENCES `storages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`settings` text,
	`updated_at` integer,
	`updated_by` text,
	`version` integer DEFAULT 1
);
--> statement-breakpoint
CREATE TABLE `storages` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text,
	`default_path` text DEFAULT '/',
	`settings` text,
	`credentials` text,
	`authType` text,
	`tags` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer
);
