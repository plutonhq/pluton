import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NotificationDeliveryStore } from '../../src/stores/NotificationDeliveryStore';
import { notificationEvents, type ChannelInput } from '../../src/types/notificationDelivery';
export const fixtureSecret = 'synthetic-notification-secret-marker';
export function notificationFixture() {
	const sqlite = new Database(':memory:');
	sqlite.pragma('foreign_keys=ON');
	sqlite.exec(`
	 CREATE TABLE plans(id TEXT PRIMARY KEY,title TEXT);
	 CREATE TABLE backups(id TEXT PRIMARY KEY,plan_id TEXT,status TEXT,in_progress INTEGER,success INTEGER,started_at INTEGER,ended_at INTEGER,created_at INTEGER,error_msg TEXT,completion_stats TEXT,task_stats TEXT,progress_stats TEXT,mirrors TEXT);
	 CREATE TABLE recovery_tests(id TEXT PRIMARY KEY,plan_id TEXT,backup_id TEXT,status TEXT,snapshot_id TEXT,created_at INTEGER,started_at INTEGER,completed_at INTEGER,result TEXT,warnings TEXT,failure_code TEXT);
	 INSERT INTO plans VALUES ('plan-01','Example Application');
	`);
	sqlite.exec(readFileSync(path.resolve('drizzle/0010_phase7_notification_outbox.sql'), 'utf8'));
	let now = Date.UTC(2026, 9, 13);
	const store = new NotificationDeliveryStore(
		sqlite,
		'synthetic-master-key-for-disposable-tests',
		() => now
	);
	const channel = (kind: 'webhook' | 'smtp' = 'webhook'): ChannelInput =>
		kind === 'webhook'
			? {
					kind,
					name: 'Example webhook',
					enabled: true,
					events: [...notificationEvents],
					secret: fixtureSecret,
					config: {
						url: 'https://notify.example.internal/events',
						timeoutMs: 1000,
						network: 'public',
						allowedCidrs: [],
					},
				}
			: {
					kind,
					name: 'Example SMTP',
					enabled: true,
					events: [...notificationEvents],
					secret: fixtureSecret,
					config: {
						host: 'smtp.example.internal',
						port: 587,
						security: 'starttls',
						username: 'notification-user',
						senderEmail: 'backup@example.invalid',
						senderName: 'Pluton',
						recipients: ['operator@example.invalid'],
						timeoutMs: 1000,
						network: 'public',
						allowedCidrs: [],
					},
				};
	function backup(jobId = 'backup-01', status = 'running', extra: Record<string, unknown> = {}) {
		sqlite
			.prepare(
				'INSERT INTO backups(id,plan_id,status,in_progress,success,started_at,ended_at,created_at,completion_stats,error_msg) VALUES (?,?,?,?,?,?,?,?,?,?)'
			)
			.run(
				jobId,
				'plan-01',
				status,
				['completed', 'failed', 'cancelled'].includes(status) ? 0 : 1,
				status === 'completed' ? 1 : 0,
				now / 1000 - 30,
				['completed', 'failed', 'cancelled'].includes(status) ? now / 1000 : null,
				now / 1000,
				JSON.stringify({
					message_type: 'summary',
					snapshot_id: 'a'.repeat(64),
					total_files_processed: 12,
					total_bytes_processed: 2048,
					...extra,
				}),
				null
			);
	}
	function recovery(
		jobId = 'recovery-01',
		status = 'running',
		extra: Record<string, unknown> = {}
	) {
		sqlite
			.prepare(
				'INSERT INTO recovery_tests(id,plan_id,backup_id,status,snapshot_id,created_at,started_at,completed_at,result,warnings,failure_code) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
			)
			.run(
				jobId,
				'plan-01',
				'backup-01',
				status,
				'a'.repeat(64),
				now / 1000,
				now / 1000 - 20,
				['queued', 'running'].includes(status) ? null : now / 1000,
				JSON.stringify({
					filesystem: { files: 12, bytes: 2048 },
					databases: [],
					cleanup: { workspace: true, databases: true },
					...extra,
				}),
				JSON.stringify(
					status === 'passed_with_warning'
						? [{ stage: 'database-import', code: 'import-disabled' }]
						: []
				),
				status === 'failed' ? 'restore-failed' : null
			);
	}
	return {
		sqlite,
		store,
		channel,
		backup,
		recovery,
		advance: (ms: number) => {
			now += ms;
		},
		now: () => now,
	};
}
