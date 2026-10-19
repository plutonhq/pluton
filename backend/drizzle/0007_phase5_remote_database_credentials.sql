CREATE TABLE `remote_plan_database_credentials` (
	`plan_id` text PRIMARY KEY NOT NULL,
	`encrypted_password` text NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE cascade
);
