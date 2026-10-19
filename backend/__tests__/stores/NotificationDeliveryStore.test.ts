import { notificationFixture, fixtureSecret } from '../fixtures/notifications';
import { notificationEvents } from '../../src/types/notificationDelivery';
describe('durable notification outbox', () => {
	let fixture: ReturnType<typeof notificationFixture>;
	beforeEach(() => {
		fixture = notificationFixture();
	});
	afterEach(() => fixture.sqlite.close());
	function subscribed() {
		const c = fixture.store.saveChannel(fixture.channel());
		fixture.store.saveSubscription('plan-01', {
			enabled: true,
			channelIds: [c.id],
			events: [...notificationEvents],
		});
		return c;
	}
	it('defers provisional internal recovery results until mandatory infrastructure cleanup is confirmed', () => {
		subscribed();
		fixture.recovery('internal-test', 'failed', {
			internalEngine: 'mariadb',
			cleanup: { workspace: true, databases: true, infrastructure: false },
		});
		expect(fixture.store.reconcile()).toBe(0);
		expect(fixture.store.deliveries()).toHaveLength(0);
		fixture.sqlite
			.prepare(
				"UPDATE recovery_tests SET status='passed',result=json_set(result,'$.cleanup.infrastructure',json('true')) WHERE id='internal-test'"
			)
			.run();
		fixture.store.reconcile();
		fixture.store.reconcile();
		expect(fixture.store.deliveries()).toHaveLength(1);
		expect(fixture.store.deliveries()[0].eventType).toBe('recovery.passed');
	});
	it.each(['running', 'retrying', 'started', 'initializing'])(
		'does not notify nonterminal backup %s',
		status => {
			subscribed();
			fixture.backup('backup-01', status);
			expect(fixture.store.reconcile()).toBe(0);
			expect(fixture.store.deliveries()).toEqual([]);
		}
	);
	it.each(['completed', 'failed', 'cancelled'])(
		'creates one logical event for persisted backup %s, despite replay',
		status => {
			subscribed();
			fixture.backup('backup-01', status);
			fixture.store.reconcile();
			fixture.store.reconcile();
			fixture.sqlite
				.prepare('UPDATE backups SET status=?,in_progress=0 WHERE id=?')
				.run(status, 'backup-01');
			fixture.store.reconcile();
			const rows = fixture.store.deliveries();
			expect(rows).toHaveLength(1);
			expect(rows[0].eventType).toBe(`backup.${status}`);
			expect(fixture.store.payload(rows[0].eventId).backup?.status).toBe(status);
		}
	);
	it('classifies warnings from persisted lifecycle metadata and never includes credentials, SQL or process output', () => {
		subscribed();
		fixture.backup('backup-01', 'completed', {
			lifecycle: {
				warnings: [
					{ stage: 'post-backup', code: 'hook-failed', output: fixtureSecret },
					{ stage: 'unknown', code: fixtureSecret },
				],
				databases: [{ password: fixtureSecret }],
				secret: fixtureSecret,
			},
			sql: fixtureSecret,
		});
		fixture.store.reconcile();
		const row = fixture.store.deliveries()[0];
		expect(row.eventType).toBe('backup.completed_with_warning');
		const payload = fixture.store.payload(row.eventId);
		expect(JSON.stringify(payload)).not.toContain(fixtureSecret);
		expect(payload.warnings).toEqual([
			{ category: 'hook-failed' },
			{ category: 'validation-warning' },
		]);
	});
	it.each(['passed', 'passed_with_warning', 'failed', 'cancelled'])(
		'binds recovery %s to the exact test and snapshot independently of backup',
		status => {
			subscribed();
			fixture.backup();
			fixture.recovery('recovery-01', status, {
				databases: [
					{
						databaseId: 'db_example',
						engine: 'mariadb',
						database: fixtureSecret,
						password: fixtureSecret,
						bytes: 500,
						artifactValidation: 'passed',
						importValidation: 'disabled',
					},
				],
			});
			fixture.store.reconcile();
			const row = fixture.store.deliveries()[0];
			const payload = fixture.store.payload(row.eventId);
			expect(row.eventType).toBe(`recovery.${status}`);
			expect(payload.recovery).toMatchObject({
				id: 'recovery-01',
				backup_id: 'backup-01',
				snapshot_id: 'a'.repeat(64),
			});
			expect(payload.summary?.databases?.[0].sql_import).toBe('not_tested');
			expect(JSON.stringify(payload)).not.toContain(fixtureSecret);
			expect((fixture.sqlite.prepare('SELECT status FROM backups').get() as any).status).toBe(
				'running'
			);
		}
	);
	it('does not replay history or already-started jobs on enable, re-enable or subscription changes', () => {
		fixture.backup('old-completed', 'completed');
		fixture.backup('old-running');
		subscribed();
		fixture.sqlite
			.prepare("UPDATE backups SET status='completed',in_progress=0 WHERE id='old-running'")
			.run();
		fixture.store.reconcile();
		expect(fixture.store.deliveries()).toHaveLength(0);
		fixture.backup('new', 'completed');
		fixture.store.reconcile();
		expect(fixture.store.deliveries()).toHaveLength(1);
	});
	it('uses intersection of global and plan event/channel subscriptions, and supports multiple destinations', () => {
		const a = fixture.store.saveChannel(fixture.channel());
		const b = fixture.store.saveChannel({
			...fixture.channel(),
			name: 'Second',
			events: ['backup.failed'],
		});
		fixture.store.saveSubscription('plan-01', {
			enabled: true,
			channelIds: [a.id, b.id],
			events: ['backup.completed', 'backup.failed'],
		});
		fixture.backup('one', 'completed');
		fixture.backup('two', 'failed');
		fixture.store.reconcile();
		expect(fixture.store.deliveries()).toHaveLength(3);
	});
	it('stores secrets encrypted, redacts read APIs and preserves blank/omitted update semantics', () => {
		const a = fixture.store.saveChannel(fixture.channel());
		const raw = fixture.sqlite
			.prepare('SELECT encrypted_secret FROM notification_channels')
			.get() as any;
		expect(raw.encrypted_secret).not.toContain(fixtureSecret);
		expect(fixture.store.channelSecret(a.id)).toBe(fixtureSecret);
		expect(JSON.stringify(fixture.store.channels())).not.toContain(fixtureSecret);
		const update = { ...fixture.channel(), secret: undefined };
		fixture.store.saveChannel(update, a.id);
		expect(fixture.store.channelSecret(a.id)).toBe(fixtureSecret);
		fixture.store.saveChannel({ ...update, secret: '' }, a.id);
		expect(fixture.store.channel(a.id)?.secretConfigured).toBe(false);
	});
	it('test notifications have their own type/history and never create backup or recovery records', () => {
		const c = fixture.store.saveChannel(fixture.channel());
		const delivery = fixture.store.test(c.id);
		expect(delivery.eventType).toBe('notification.test');
		expect(fixture.sqlite.prepare('SELECT id FROM backups').all()).toHaveLength(0);
		expect(fixture.sqlite.prepare('SELECT id FROM recovery_tests').all()).toHaveLength(0);
	});
	it('recovers an expired sending lease after a process restart, and refuses stale completion tokens', () => {
		const c = fixture.store.saveChannel(fixture.channel());
		fixture.store.test(c.id);
		const first = fixture.store.claim('first')!;
		fixture.advance(61000);
		expect(fixture.store.claim('second')).toBeUndefined();
		fixture.advance(30000);
		const second = fixture.store.claim('second')!;
		expect(second.eventId).toBe(first.eventId);
		expect(second.attemptCount).toBe(2);
		fixture.store.finish(first, { success: true });
		expect(fixture.store.delivery(first.id)?.status).toBe('sending');
		fixture.store.finish(second, { success: true });
		expect(fixture.store.delivery(first.id)?.status).toBe('succeeded');
	});
	it('bounds exponential retries and Retry-After, then allows only bounded explicit manual retry cycles', () => {
		const c = fixture.store.saveChannel(fixture.channel());
		fixture.store.test(c.id);
		for (let attempt = 1; attempt <= 5; attempt++) {
			const row = fixture.store.claim(`owner-${attempt}`)!;
			expect(row.cycleAttempts).toBe(attempt);
			fixture.store.finish(row, {
				success: false,
				code: 'http-retryable',
				retryable: true,
				retryAfterSeconds: 999999,
			});
			if (attempt < 5) {
				expect(fixture.store.delivery(row.id)?.nextAttemptAt! - fixture.now()).toBe(3600000);
				fixture.advance(3600000);
			} else expect(fixture.store.delivery(row.id)?.status).toBe('failed');
		}
		const row = fixture.store.deliveries()[0];
		fixture.store.retry(row.id);
		expect(fixture.store.delivery(row.id)?.nextAttemptAt! - fixture.now()).toBe(30000);
		fixture.advance(30000);
		fixture.store.finish(fixture.store.claim('manual')!, { success: false, code: 'http-rejected' });
		expect(fixture.store.delivery(row.id)?.attemptCount).toBe(6);
	});
	it('does not automatically retry permanent failures or send after policy/channel disable', () => {
		const c = subscribed();
		fixture.backup('one', 'failed');
		fixture.store.reconcile();
		const row = fixture.store.claim('worker')!;
		fixture.store.finish(row, { success: false, code: 'http-rejected', retryable: false });
		fixture.advance(3600000);
		expect(fixture.store.claim('worker')).toBeUndefined();
		fixture.store.deleteChannel(c.id);
		expect(fixture.store.channelSecret(c.id)).toBeUndefined();
		expect(fixture.store.delivery(row.id)?.canRetry).toBe(false);
		expect(() => fixture.store.retry(row.id)).toThrow();
	});
	it('bounds queue growth without altering job status or losing an unseen terminal event', () => {
		const c = subscribed();
		fixture.sqlite.exec(
			`WITH RECURSIVE n(x) AS(SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<10000) INSERT INTO notification_events SELECT 'event-'||x,'key-'||x,'notification.test',NULL,NULL,'{}',0 FROM n`
		);
		fixture.sqlite
			.prepare(
				"INSERT INTO notification_deliveries(id,event_id,channel_id,channel_name,kind,revision,created_at,next_attempt_at) SELECT id,id,?,'fixture','webhook',1,0,0 FROM notification_events"
			)
			.run(c.id);
		expect(() => fixture.store.test(c.id)).toThrow('queue is full');
		fixture.backup('new', 'completed');
		expect(fixture.store.reconcile()).toBe(0);
		expect((fixture.sqlite.prepare('SELECT status FROM backups').get() as any).status).toBe(
			'completed'
		);
		fixture.sqlite.exec("DELETE FROM notification_deliveries WHERE id='event-1'");
		fixture.store.reconcile();
		expect(fixture.store.deliveries()[0].eventType).toBe('backup.completed');
	});
	it('enforces two leased deliveries across workers and finalizes a crash at the attempt limit', () => {
		const channel = fixture.store.saveChannel(fixture.channel());
		for (let n = 0; n < 3; n++) fixture.store.test(channel.id);
		const first = fixture.store.claim('one')!,
			second = fixture.store.claim('two')!;
		expect(fixture.store.claim('three')).toBeUndefined();
		fixture.store.finish(first, { success: true });
		expect(fixture.store.claim('three')).toBeDefined();
		fixture.sqlite
			.prepare('UPDATE notification_deliveries SET cycle_attempts=5 WHERE id=?')
			.run(second.id);
		fixture.advance(61000);
		fixture.store.claim('restart');
		const row = fixture.store.delivery(second.id)!;
		expect(row.status).toBe('failed');
		expect(row.completedAt).toBe(fixture.now());
		expect(row.nextAttemptAt).toBeNull();
	});
	it('keeps dedup markers after bounded history retention and survives source deletion without sequence reuse', () => {
		subscribed();
		fixture.backup('one', 'completed');
		fixture.store.reconcile();
		fixture.store.finish(fixture.store.claim('worker')!, { success: true });
		fixture.advance(31 * 86400000);
		fixture.store.maintenance();
		expect(fixture.store.deliveries()).toHaveLength(0);
		fixture.store.reconcile();
		expect(fixture.store.deliveries()).toHaveLength(0);
		const before = (
			fixture.sqlite.prepare('SELECT MAX(id) id FROM notification_sources').get() as any
		).id;
		fixture.sqlite.exec("DELETE FROM backups WHERE id='one'");
		fixture.backup('two', 'completed');
		expect(
			(fixture.sqlite.prepare('SELECT MAX(id) id FROM notification_sources').get() as any).id
		).toBeGreaterThan(before);
	});
});
