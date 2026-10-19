CREATE TABLE `notification_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`deleted` integer DEFAULT 0 NOT NULL,
	`events` text NOT NULL,
	`config` text NOT NULL,
	`encrypted_secret` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`source_floor` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notification_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`channel_name` text NOT NULL,
	`kind` text NOT NULL,
	`revision` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`cycle_attempts` integer DEFAULT 0 NOT NULL,
	`manual_retries` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`last_attempt_at` integer,
	`next_attempt_at` integer,
	`completed_at` integer,
	`lease_until` integer,
	`lease_owner` text,
	`error_code` text,
	`http_status` integer,
	FOREIGN KEY (`event_id`) REFERENCES `notification_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `notification_channels`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_delivery_event_channel` ON `notification_deliveries` (`event_id`,`channel_id`);--> statement-breakpoint
CREATE INDEX `notification_delivery_due` ON `notification_deliveries` (`status`,`next_attempt_at`,`lease_until`);--> statement-breakpoint
CREATE TABLE `notification_events` (
	`id` text PRIMARY KEY NOT NULL,
	`logical_key` text NOT NULL,
	`event_type` text NOT NULL,
	`plan_id` text,
	`plan_name` text,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_events_logical_key_unique` ON `notification_events` (`logical_key`);--> statement-breakpoint
CREATE INDEX `notification_event_created` ON `notification_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `notification_observed` (
	`source_id` integer NOT NULL,
	`terminal_status` text NOT NULL,
	PRIMARY KEY(`source_id`, `terminal_status`),
	FOREIGN KEY (`source_id`) REFERENCES `notification_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `notification_sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`job_id` text NOT NULL,
	`ready` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_source_job` ON `notification_sources` (`kind`,`job_id`);--> statement-breakpoint
CREATE INDEX `notification_source_ready` ON `notification_sources` (`ready`,`id`);--> statement-breakpoint
CREATE TABLE `notification_subscriptions` (
	`plan_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`channel_ids` text NOT NULL,
	`events` text NOT NULL,
	`source_floor` integer NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO notification_sources(kind,job_id) SELECT 'backup',id FROM backups;
--> statement-breakpoint
INSERT INTO notification_sources(kind,job_id) SELECT 'recovery',id FROM recovery_tests;
--> statement-breakpoint
INSERT INTO notification_observed SELECT s.id,b.status FROM notification_sources s JOIN backups b ON s.kind='backup' AND s.job_id=b.id WHERE b.status IN ('completed','failed','cancelled') AND COALESCE(b.in_progress,0)=0;
--> statement-breakpoint
INSERT INTO notification_observed SELECT s.id,r.status FROM notification_sources s JOIN recovery_tests r ON s.kind='recovery' AND s.job_id=r.id WHERE r.status NOT IN ('queued','running');
--> statement-breakpoint
CREATE TRIGGER notification_backup_created AFTER INSERT ON backups BEGIN
 INSERT OR IGNORE INTO notification_sources(kind,job_id,ready) VALUES ('backup',NEW.id,CASE WHEN NEW.status IN ('completed','failed','cancelled') AND COALESCE(NEW.in_progress,0)=0 THEN 1 ELSE 0 END);
END;
--> statement-breakpoint
CREATE TRIGGER notification_recovery_created AFTER INSERT ON recovery_tests BEGIN
 INSERT OR IGNORE INTO notification_sources(kind,job_id,ready) VALUES ('recovery',NEW.id,CASE WHEN NEW.status IN ('passed','passed_with_warning','failed','cancelled') THEN 1 ELSE 0 END);
END;
--> statement-breakpoint
CREATE TRIGGER notification_backup_terminal AFTER UPDATE OF status,in_progress ON backups
 WHEN NEW.status IN ('completed','failed','cancelled') AND COALESCE(NEW.in_progress,0)=0 AND (OLD.status IS NOT NEW.status OR COALESCE(OLD.in_progress,0)<>COALESCE(NEW.in_progress,0)) BEGIN
 UPDATE notification_sources SET ready=1 WHERE kind='backup' AND job_id=NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER notification_recovery_terminal AFTER UPDATE OF status ON recovery_tests
 WHEN NEW.status IN ('passed','passed_with_warning','failed','cancelled') AND OLD.status IS NOT NEW.status BEGIN
 UPDATE notification_sources SET ready=1 WHERE kind='recovery' AND job_id=NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER notification_backup_removed AFTER DELETE ON backups BEGIN
 DELETE FROM notification_sources WHERE kind='backup' AND job_id=OLD.id;
END;
--> statement-breakpoint
CREATE TRIGGER notification_recovery_removed AFTER DELETE ON recovery_tests BEGIN
 DELETE FROM notification_sources WHERE kind='recovery' AND job_id=OLD.id;
END;
