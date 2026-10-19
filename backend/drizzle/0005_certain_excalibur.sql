CREATE TABLE `agent_commands` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`leased_at` integer,
	`lease_owner` text,
	`lease_expires_at` integer,
	`acknowledged_at` integer,
	`completed_at` integer,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`last_event_sequence` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	FOREIGN KEY (`agent_id`) REFERENCES `agent_identities`(`agent_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_commands_idempotency_key_idx` ON `agent_commands` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `agent_commands_agent_state_idx` ON `agent_commands` (`agent_id`,`state`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_commands_lease_expires_at_idx` ON `agent_commands` (`lease_expires_at`);--> statement-breakpoint
CREATE TABLE `agent_enrollment_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`device_name` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`used_at` integer,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_enrollment_tokens_token_hash_idx` ON `agent_enrollment_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `agent_identities` (
	`agent_id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`encrypted_secret` text NOT NULL,
	`hostname` text NOT NULL,
	`os` text NOT NULL,
	`architecture` text NOT NULL,
	`agent_version` text NOT NULL,
	`restic_version` text,
	`rclone_version` text,
	`capabilities` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_seen` integer,
	`revoked_at` integer,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_identities_device_id_unique` ON `agent_identities` (`device_id`);--> statement-breakpoint
CREATE INDEX `agent_identities_device_id_idx` ON `agent_identities` (`device_id`);--> statement-breakpoint
CREATE TABLE `agent_request_nonces` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`nonce_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agent_identities`(`agent_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_request_nonces_agent_nonce_idx` ON `agent_request_nonces` (`agent_id`,`nonce_hash`);--> statement-breakpoint
CREATE INDEX `agent_request_nonces_expires_at_idx` ON `agent_request_nonces` (`expires_at`);