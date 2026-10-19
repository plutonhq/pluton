import type { NotificationPayload, NotificationEventType } from '../types/notificationDelivery';
// Deliberately project closed, documented metadata. Never spread a job/config/error.
type Row = Record<string, any>;
const json = (value: unknown): Row => {
	try {
		return typeof value === 'string' ? JSON.parse(value) : value || {};
	} catch {
		return {};
	}
};
const count = (value: unknown) =>
	typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
const snapshot = (value: unknown) =>
	typeof value === 'string' && /^[a-f0-9]{8,64}$/.test(value) ? value : null;
const identifier = (value: unknown) =>
	typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value) ? value : undefined;
const time = (value: unknown) =>
	typeof value === 'number' && Number.isFinite(value)
		? new Date(value * 1000).toISOString()
		: undefined;
const safeCodes = new Set([
	'cancelled',
	'interrupted',
	'import-disabled',
	'unexpected',
	'source-parent-not-traversable',
	'source-root-not-readable',
	'source-entry-inaccessible',
	'source-missing',
	'source-symlink-escape',
	'source-unsupported-type',
	'source-policy-violation',
	'database-auth-failed',
	'database-privileges-failed',
	'database-authentication-failed',
	'database-insufficient-privileges',
	'database-connection-failed',
	'database-tls-failed',
	'database-dump-failed',
	'database-dump-timeout',
	'database-client-missing',
	'database-client-incompatible',
	'database-configuration-invalid',
	'database-invalid-configuration',
	'database-unavailable',
	'database-tls-verification-failed',
	'database-tool-unavailable',
	'database-dump-invalid',
	'database-output-empty',
	'database-dump-output-limit',
	'invalid-payload',
	'source-validation-failed',
	'state-overlap',
	'state-validation-failed',
	'tool-unavailable',
	'sftp-password-obscure-failed',
	'temporary-config-failed',
	'repository-check-failed',
	'repository-target-check-failed',
	'repository-target-not-empty',
	'target-check-access-failed',
	'target-check-auth-failed',
	'target-check-transport-failed',
	'repository-initialization-failed',
	'restic-backup-failed',
	'restic-summary-missing',
	'workspace-failed',
	'hook-invalid',
	'hook-output-limit',
	'snapshot-confirmation-failed',
	'lifecycle-invalid',
	'database-import-failed',
	'database-import-validation-failed',
	'database-import-timeout',
	'database-cleanup-failed',
	'workspace-cleanup-failed',
	'unsafe-workspace',
	'snapshot-not-found',
	'snapshot-binding-mismatch',
	'snapshot-metadata-invalid',
	'repository-auth-failed',
	'repository-access-failed',
	'restore-failed',
	'restore-timeout',
	'unsupported-snapshot-file',
	'workspace-size-limit',
	'insufficient-space',
	'database-target-unavailable',
	'database-already-exists',
	'database-output-limit',
	'database-role-missing',
	'restored-file-count-mismatch',
	'restored-file-size-mismatch',
	'source-tree-missing',
	'database-artifact-missing',
	'database-artifact-size-mismatch',
	'database-artifact-hash-mismatch',
	'database-metadata-incomplete',
	'recovery-target-not-configured',
	'recovery-target-unsafe',
	'hook-failed',
	'hook-timeout',
	'cleanup-failed',
]);
function category(value: unknown, fallback = 'job-failed'): string {
	return typeof value === 'string' && safeCodes.has(value) ? value : fallback;
}
export function terminalPayload(
	kind: 'backup' | 'recovery',
	row: Row,
	eventId: string,
	now: number
): NotificationPayload {
	const stats = json(row.completion_stats);
	const result = json(row.result);
	const warnings = kind === 'backup' ? stats.lifecycle?.warnings : json(row.warnings);
	const eventType: NotificationEventType =
		kind === 'backup'
			? row.status === 'completed'
				? Array.isArray(warnings) && warnings.length
					? 'backup.completed_with_warning'
					: 'backup.completed'
				: row.status === 'cancelled'
					? 'backup.cancelled'
					: 'backup.failed'
			: (`recovery.${row.status}` as NotificationEventType);
	const payload: NotificationPayload = {
		version: 1,
		event_id: eventId,
		event_type: eventType,
		timestamp: new Date(now).toISOString(),
		plan: {
			id: row.plan_id,
			name: Array.from(String(row.plan_name || 'Backup plan'))
				.filter(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
				.join('')
				.slice(0, 120),
		},
		started_at: time(row.started_at),
		completed_at: time(kind === 'backup' ? row.ended_at : row.completed_at),
	};
	const ended = kind === 'backup' ? row.ended_at : row.completed_at;
	if (typeof row.started_at === 'number' && typeof ended === 'number' && ended >= row.started_at)
		payload.duration_seconds = ended - row.started_at;
	if (kind === 'backup') {
		payload.backup = { id: row.id, status: row.status, snapshot_id: snapshot(stats.snapshot_id) };
		payload.summary = {
			files: count(stats.total_files_processed),
			bytes: count(stats.total_bytes_processed),
		};
		const artifacts =
			stats.lifecycle?.databases || (stats.lifecycle?.database ? [stats.lifecycle.database] : []);
		if (Array.isArray(artifacts))
			payload.summary.databases = artifacts.slice(0, 8).map((db: Row) => ({
				database_id: identifier(db.databaseId),
				engine: ['mariadb', 'mysql', 'postgresql'].includes(db.engine) ? db.engine : undefined,
				bytes: count(db.bytes) || 0,
				artifact_integrity: 'archived_in_snapshot',
				sql_import: 'not_tested',
			}));
	} else {
		payload.recovery = {
			id: row.id,
			backup_id: row.backup_id,
			status: row.status,
			snapshot_id: snapshot(row.snapshot_id) || '',
		};
		payload.summary = {
			files: count(result.filesystem?.files),
			bytes: count(result.filesystem?.bytes),
			databases: Array.isArray(result.databases)
				? result.databases.slice(0, 8).map((db: Row) => ({
						database_id: identifier(db.databaseId),
						engine: ['mariadb', 'mysql', 'postgresql'].includes(db.engine) ? db.engine : undefined,
						bytes: count(db.bytes) || 0,
						artifact_integrity: ['passed', 'failed', 'pending'].includes(db.artifactValidation)
							? db.artifactValidation
							: 'not_tested',
						sql_import: ['passed', 'failed', 'pending'].includes(db.importValidation)
							? db.importValidation
							: 'not_tested',
					}))
				: [],
			cleanup: {
				workspace: result.cleanup?.workspace === true,
				databases: result.cleanup?.databases === true,
			},
		};
	}
	if (row.status === 'failed')
		payload.error = {
			category: category(
				row.failure_code ||
					(row.progress_stats && json(row.progress_stats).failureCode) ||
					[...safeCodes].find(
						code =>
							typeof row.error_msg === 'string' &&
							(row.error_msg.includes(`/${code})`) || row.error_msg.includes(`/${code}; `))
					)
			),
		};
	if (row.status === 'cancelled') payload.error = { category: 'cancelled' };
	if (Array.isArray(warnings))
		payload.warnings = warnings
			.slice(0, 24)
			.map(warning => ({ category: category(warning.code, 'validation-warning') }));
	return payload;
}
export function notificationText(payload: NotificationPayload): { subject: string; text: string } {
	const labels: Record<string, string> = {
		'backup.completed': 'Backup Successful',
		'backup.completed_with_warning': 'Backup Completed with Warning',
		'backup.failed': 'Backup Failed',
		'backup.cancelled': 'Backup Cancelled',
		'recovery.passed': 'Recovery Test Passed',
		'recovery.passed_with_warning': 'Recovery Test Passed with Warning',
		'recovery.failed': 'Recovery Test Failed',
		'recovery.cancelled': 'Recovery Test Cancelled',
		'notification.test': 'Test Notification',
	};
	const lines = [
		`Pluton — ${labels[payload.event_type]}`,
		`Event: ${payload.event_type}`,
		`Event ID: ${payload.event_id}`,
	];
	if (payload.plan) lines.push(`Plan: ${payload.plan.name} (${payload.plan.id})`);
	if (payload.backup)
		lines.push(
			`Backup: ${payload.backup.id}`,
			`Result: ${payload.backup.status}`,
			`Snapshot: ${payload.backup.snapshot_id || 'Not available'}`
		);
	if (payload.recovery)
		lines.push(
			`Recovery test: ${payload.recovery.id}`,
			`Backup: ${payload.recovery.backup_id}`,
			`Result: ${payload.recovery.status}`,
			`Exact snapshot tested: ${payload.recovery.snapshot_id}`
		);
	lines.push(
		`Started: ${payload.started_at || 'Not available'}`,
		`Completed: ${payload.completed_at || payload.timestamp}`,
		`Duration: ${payload.duration_seconds ?? 'Not available'} seconds`
	);
	if (payload.error) lines.push(`Failure classification: ${payload.error.category}`);
	if (payload.summary) {
		lines.push(
			`Regular files: ${payload.summary.files ?? 'Not available'}`,
			`Bytes: ${payload.summary.bytes ?? 'Not available'}`
		);
		for (const db of payload.summary.databases || [])
			lines.push(
				`Database artifact ${db.database_id || ''} (${db.engine || 'database'}): ${db.bytes} bytes; artifact integrity ${db.artifact_integrity}; SQL import ${db.sql_import === 'not_tested' ? 'NOT TESTED' : db.sql_import}`
			);
		if (payload.summary.cleanup)
			lines.push(
				`Cleanup: workspace ${payload.summary.cleanup.workspace ? 'complete' : 'incomplete'}, databases ${payload.summary.cleanup.databases ? 'complete' : 'incomplete'}`
			);
	}
	for (const warning of payload.warnings || []) lines.push(`Warning: ${warning.category}`);
	if (payload.recovery)
		lines.push(
			'Structural restore / artifact integrity is not a guarantee of semantic application recovery. SQL import is validated only when explicitly reported passed.'
		);
	return {
		subject: `[Pluton] ${labels[payload.event_type]}${payload.plan ? ` — ${payload.plan.name}` : ''}`,
		text: lines.join('\n'),
	};
}
