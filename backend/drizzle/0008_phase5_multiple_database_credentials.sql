CREATE TABLE `remote_plan_database_entry_credentials` (
	`database_id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`encrypted_password` text NOT NULL,
	`legacy_single` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `remote_plan_database_entry_plan_idx` ON `remote_plan_database_entry_credentials` (`plan_id`);
--> statement-breakpoint
-- Copy ciphertext byte-for-byte. No secret key or plaintext is involved.
INSERT INTO `remote_plan_database_entry_credentials`
  (`database_id`, `plan_id`, `encrypted_password`, `legacy_single`)
SELECT 'db_' || lower(hex(randomblob(16))), c.plan_id, c.encrypted_password, 1
FROM remote_plan_database_credentials c
JOIN plans p ON p.id = c.plan_id
WHERE json_valid(p.settings)
  AND json_extract(p.settings, '$.remoteLifecycle.version') = 1
  AND json_type(p.settings, '$.remoteLifecycle.database') = 'object';
--> statement-breakpoint
-- Bind the existing logical config to the generated ID in the same migration
-- transaction. Keep the original credential table for additive compatibility.
UPDATE plans SET settings = json_remove(json_set(settings,
  '$.remoteLifecycle.version', 2,
  '$.remoteLifecycle.databases', json_array(json_set(json_remove(
    json_extract(settings, '$.remoteLifecycle.database'), '$.password'),
    '$.databaseId', (SELECT database_id FROM remote_plan_database_entry_credentials c
      WHERE c.plan_id = plans.id AND c.legacy_single = 1),
    '$.passwordConfigured', json('true')))
), '$.remoteLifecycle.database')
WHERE id IN (SELECT plan_id FROM remote_plan_database_entry_credentials WHERE legacy_single = 1);
