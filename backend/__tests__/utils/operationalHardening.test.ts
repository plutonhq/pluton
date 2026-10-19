import { mergeRemoteProgress, projectRemoteProgress } from '../../src/utils/remoteBackupProgress';
import { remoteBackupFailure } from '../../src/utils/remoteBackupDiagnostics';
import type { Backup } from '../../src/db/schema/backups';
const row = (values: Partial<Backup> = {}) =>
	({
		id: 'backup-01',
		planId: 'plan-01',
		sourceId: 'app-01',
		status: 'queued',
		inProgress: true,
		createdAt: new Date('2026-01-01'),
		...values,
	}) as Backup;
describe('durable remote backup progress', () => {
	it('filesystem-only and DB stages project real counters in the existing event envelope', () => {
		for (const stage of [
			'validating-source',
			'dumping-database',
			'preparing-repository',
			'backing-up',
			'verifying-snapshot',
		]) {
			const update = mergeRemoteProgress(row(), 'command-01', 1, 1, {
				backupStage: stage,
				progress: {
					bytesProcessed: 7,
					filesProcessed: 2,
					totalBytesProcessed: 10,
					totalFilesProcessed: 3,
				},
			});
			const projected = projectRemoteProgress(row(update!));
			expect(projected).toMatchObject({
				remote: true,
				backupStage: stage,
				events: [
					{
						phase: 'backup',
						completed: false,
						resticData: { bytes_done: 7, files_done: 2, total_bytes: 10, total_files: 3 },
					},
				],
			});
			expect(projected.events[0].resticData).not.toHaveProperty('percent_done');
		}
	});
	it('supports v0.4.0 lifecycle events and stage-less filesystem counters', () => {
		expect(
			mergeRemoteProgress(row(), 'command-01', 1, 1, { lifecycleStage: 'database-dump-started' })
				?.progressStats?.backupStage
		).toBe('dumping-database');
		expect(projectRemoteProgress(row({ status: 'started' })).backupStage).toBe('backing-up');
	});
	it('rejects stale attempts/sequences; same attempt never regresses counters or stage', () => {
		const initial = mergeRemoteProgress(row(), 'command-01', 2, 8, {
			backupStage: 'verifying-snapshot',
			progress: { bytesProcessed: 100, filesProcessed: 10 },
		})!;
		const current = row(initial);
		for (const [attempt, sequence] of [
			[1, 100],
			[2, 8],
			[2, 7],
		])
			expect(
				mergeRemoteProgress(current, 'command-01', attempt, sequence, { backupStage: 'backing-up' })
			).toBeNull();
		const late = mergeRemoteProgress(current, 'command-01', 2, 9, {
			backupStage: 'backing-up',
			progress: { bytesProcessed: 1 },
		});
		expect(late?.progressStats).toMatchObject({
			backupStage: 'verifying-snapshot',
			bytesProcessed: 100,
		});
		const retry = mergeRemoteProgress(current, 'command-01', 3, 1, { phase: 'accepted' });
		expect(retry).toMatchObject({
			status: 'queued',
			progressStats: { bytesProcessed: 0, remoteAttempt: 3 },
		});
	});
	it.each(['completed', 'failed', 'cancelled'])(
		'late events never overwrite %s, including reconnect',
		status => {
			expect(
				mergeRemoteProgress(row({ status, inProgress: false }), 'command-01', 99, 999, {
					phase: 'running',
				})
			).toBeNull();
			const projected = projectRemoteProgress(row({ status, inProgress: false }));
			expect(projected.events[0]).toMatchObject({
				phase: 'finished',
				completed: true,
				action:
					status === 'completed'
						? 'TASK_COMPLETED'
						: status === 'failed'
							? 'TASK_FAILED'
							: 'TASK_CANCELLED',
			});
		}
	);
});
describe('safe operational errors', () => {
	it('progress projection never forwards historical provider error text', () => {
		const projected = projectRemoteProgress(
			row({ status: 'failed', inProgress: false, errorMsg: 'test-only-old-provider-secret' })
		);
		expect(JSON.stringify(projected)).not.toContain('test-only-old-provider-secret');
		expect(projected.startTime).toBe('2026-01-01T00:00:00.000Z');
	});
	it('1044 privileges have actionable semantics; auth/TLS/config retain distinct safe messages', () => {
		const error = remoteBackupFailure({
			failureStage: 'database-dump',
			failureCode: 'database-insufficient-privileges',
			databaseId: 'db_one',
			engine: 'mariadb',
		});
		expect(error).toContain('password may be correct');
		expect(error).toContain('database-insufficient-privileges');
		expect(error).toContain('db_one');
		expect(remoteBackupFailure({ failureCode: 'database-auth-failed' })).toContain(
			'authentication failed'
		);
		expect(remoteBackupFailure({ failureCode: 'database-tls-verification-failed' })).toContain(
			'TLS verification failed'
		);
	});
	it('raw provider text, URL, unknown stage/code and secret-bearing IDs are never returned', () => {
		const error = remoteBackupFailure({
			failureCode: 'test-only-password',
			failureStage: 'test-only-token',
			databaseId: 'https://example.invalid/?token=test-only',
			engine: 'secret',
		});
		expect(error).not.toMatch(/test-only|https|secret/);
		expect(error).toContain('unknown-stage/unspecified');
	});
});
