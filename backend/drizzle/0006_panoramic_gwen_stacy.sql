CREATE TABLE `remote_managed_repositories` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`storage_id` text NOT NULL,
	`storage_path` text NOT NULL,
	`encrypted_password` text NOT NULL,
	`initialized_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_id`) REFERENCES `agent_identities`(`agent_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`storage_id`) REFERENCES `storages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `remote_managed_repositories_plan_id_idx` ON `remote_managed_repositories` (`plan_id`);--> statement-breakpoint
CREATE INDEX `remote_managed_repositories_agent_id_idx` ON `remote_managed_repositories` (`agent_id`);