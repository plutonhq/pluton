import { RemoteBackupService } from '../../src/services/RemoteBackupService';
import { notificationFixture } from '../fixtures/notifications';
import { notificationEvents } from '../../src/types/notificationDelivery';
jest.mock('../../src/services/ConfigService', () => ({
	configService: { config: { SECRET: 'synthetic-lifecycle-secret' } },
}));
describe('real remote completion callbacks and durable notifications', () => {
	let fixture: ReturnType<typeof notificationFixture>;
	beforeEach(() => {
		fixture = notificationFixture();
		const c = fixture.store.saveChannel(fixture.channel());
		fixture.store.saveSubscription('plan-01', {
			enabled: true,
			channelIds: [c.id],
			events: [...notificationEvents],
		});
		fixture.backup();
	});
	afterEach(() => fixture.sqlite.close());
	function service() {
		const plan = {
			id: 'plan-01',
			title: 'Example Application',
			method: 'backup',
			settings: { notification: {} },
			stats: null,
		};
		const backupStore: any = {
			getById: jest.fn(async (id: string) => {
				const row = fixture.sqlite.prepare('SELECT * FROM backups WHERE id=?').get(id) as any;
				return {
					...row,
					inProgress: !!row.in_progress,
					completionStats: JSON.parse(row.completion_stats),
					started: new Date(row.started_at * 1000),
					planId: row.plan_id,
				};
			}),
			update: jest.fn(async (id: string, value: any) => {
				for (const [key, column] of Object.entries({
					status: 'status',
					inProgress: 'in_progress',
					success: 'success',
					ended: 'ended_at',
					completionStats: 'completion_stats',
					taskStats: 'task_stats',
					errorMsg: 'error_msg',
				})) {
					if (!(key in value)) continue;
					const raw = value[key];
					fixture.sqlite
						.prepare(`UPDATE backups SET ${column}=? WHERE id=?`)
						.run(
							raw instanceof Date
								? Math.floor(raw.getTime() / 1000)
								: typeof raw === 'boolean'
									? +raw
									: typeof raw === 'object' && raw !== null
										? JSON.stringify(raw)
										: raw,
							id
						);
				}
				return backupStore.getById(id);
			}),
		};
		return new RemoteBackupService(
			{ markInitialized: jest.fn() } as any,
			{} as any,
			{ getById: jest.fn().mockResolvedValue(plan), update: jest.fn() } as any,
			backupStore,
			{} as any
		);
	}
	const command: any = {
		type: 'BACKUP_FILESYSTEM',
		state: 'completed',
		payload: { planId: 'plan-01', backupId: 'backup-01', repositoryId: 'repository-01' },
	};
	it('success is queued only after server persistence and replayed agent completion never duplicates an event', async () => {
		const runner = service();
		expect(fixture.store.reconcile()).toBe(0);
		const completion: any = {
			success: true,
			result: {
				snapshotId: 'a'.repeat(64),
				summary: {
					message_type: 'summary',
					snapshot_id: 'a'.repeat(64),
					total_files_processed: 12,
					total_bytes_processed: 2048,
				},
			},
		};
		await runner.completeCommand(command, completion);
		fixture.store.reconcile();
		await runner.completeCommand(command, completion);
		fixture.store.reconcile();
		expect(fixture.store.deliveries()).toHaveLength(1);
		expect(fixture.store.deliveries()[0].eventType).toBe('backup.completed');
	});
	it('a snapshot without required valid lifecycle metadata is not unconditional success', async () => {
		const runner = service();
		await runner.completeCommand(command, {
			success: true,
			result: {
				snapshotId: 'a'.repeat(64),
				summary: { message_type: 'summary', snapshot_id: 'b'.repeat(64) },
			},
		} as any);
		fixture.store.reconcile();
		expect(fixture.store.deliveries()[0].eventType).toBe('backup.failed');
		expect((fixture.sqlite.prepare('SELECT status FROM backups').get() as any).status).toBe(
			'failed'
		);
	});
	it.each([false, true])(
		'agent failure / cancellation = %s persists before notification and never exposes provider text',
		async cancelled => {
			const runner = service();
			await runner.completeCommand({ ...command, state: cancelled ? 'cancelled' : 'failed' }, {
				success: false,
				cancelled,
				error: 'synthetic-unsafe-process-output',
				failureStage: 'database-dump',
				failureCode: 'database-insufficient-privileges',
				databaseId: 'db_example',
				engine: 'mariadb',
				result: { snapshotId: 'a'.repeat(64) },
			} as any);
			fixture.store.reconcile();
			expect(fixture.store.deliveries()[0].eventType).toBe(
				cancelled ? 'backup.cancelled' : 'backup.failed'
			);
			expect(
				JSON.stringify(fixture.store.payload(fixture.store.deliveries()[0].eventId))
			).not.toContain('synthetic-unsafe-process-output');
			expect(fixture.store.payload(fixture.store.deliveries()[0].eventId).error?.category).toBe(
				cancelled ? 'cancelled' : 'database-insufficient-privileges'
			);
		}
	);
});
