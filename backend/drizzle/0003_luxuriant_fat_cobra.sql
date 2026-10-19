CREATE TABLE `legacy_repositories` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`repository_path` text NOT NULL,
	`backend` text DEFAULT 'local' NOT NULL,
	`encrypted_password` text NOT NULL,
	`is_read_only` integer DEFAULT true NOT NULL,
	`validation_status` text DEFAULT 'unknown' NOT NULL,
	`last_validated_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer
);
