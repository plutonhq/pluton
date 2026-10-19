import { notificationFixture, fixtureSecret } from '../fixtures/notifications';
import { NotificationDeliveryManager } from '../../src/notifications/NotificationDeliveryManager';
import { serverLogger } from '../../src/utils/logger';
jest.mock('../../src/utils/logger', () => ({
	initializeLogger: jest.fn(),
	serverLogger: { warn: jest.fn() },
}));
describe('isolated bounded delivery worker', () => {
	let fixture: ReturnType<typeof notificationFixture>;
	beforeEach(() => {
		fixture = notificationFixture();
	});
	afterEach(() => fixture.sqlite.close());
	it('has at most two in-flight deliveries and durably processes the remainder on the next tick', async () => {
		const c = fixture.store.saveChannel(fixture.channel());
		for (let n = 0; n < 3; n++) fixture.store.test(c.id);
		const resolves: ((value: any) => void)[] = [];
		const deliver = jest.fn(() => new Promise<any>(resolve => resolves.push(resolve)));
		const manager = new NotificationDeliveryManager(fixture.store, deliver);
		manager.start();
		expect(deliver).toHaveBeenCalledTimes(2);
		resolves.forEach(resolve => resolve({ success: true }));
		await new Promise(setImmediate);
		manager.tick();
		expect(deliver).toHaveBeenCalledTimes(3);
		resolves[2]({ success: true });
		await manager.shutdown();
		expect(fixture.store.deliveries().every(row => row.status === 'succeeded')).toBe(true);
	});
	it.each(['disable', 'delete', 'edit'])(
		'does not send after a pending channel %s',
		async change => {
			const c = fixture.store.saveChannel(fixture.channel());
			fixture.store.test(c.id);
			if (change === 'delete') fixture.store.deleteChannel(c.id);
			else fixture.store.saveChannel({ ...fixture.channel(), enabled: change !== 'disable' }, c.id);
			const deliver = jest.fn();
			const manager = new NotificationDeliveryManager(fixture.store, deliver);
			manager.start();
			await manager.shutdown();
			expect(deliver).not.toHaveBeenCalled();
			expect(fixture.store.deliveries()[0].status).toBe('failed');
		}
	);
	it('disabled plan subscriptions suppress pending deliveries while test events remain independent', async () => {
		const c = fixture.store.saveChannel(fixture.channel());
		fixture.store.saveSubscription('plan-01', {
			enabled: true,
			channelIds: [c.id],
			events: ['backup.completed'],
		});
		fixture.backup('one', 'completed');
		fixture.store.reconcile();
		fixture.store.saveSubscription('plan-01', {
			enabled: false,
			channelIds: [c.id],
			events: ['backup.completed'],
		});
		const deliver = jest.fn();
		const manager = new NotificationDeliveryManager(fixture.store, deliver);
		manager.start();
		await manager.shutdown();
		expect(deliver).not.toHaveBeenCalled();
		expect(fixture.store.deliveries()[0].errorCode).toBe('subscription-disabled');
	});
	it('provider failures and corrupted stored credentials cannot alter backup outcomes or log raw secrets', async () => {
		const c = fixture.store.saveChannel(fixture.channel());
		fixture.store.saveSubscription('plan-01', {
			enabled: true,
			channelIds: [c.id],
			events: ['backup.completed'],
		});
		fixture.backup('one', 'completed');
		const manager = new NotificationDeliveryManager(
			fixture.store,
			jest.fn().mockRejectedValue(new Error(fixtureSecret))
		);
		manager.start();
		await manager.shutdown();
		expect(fixture.store.deliveries()[0].errorCode).toBe('delivery-failed');
		expect(JSON.stringify(jest.mocked(serverLogger!.warn).mock.calls)).not.toContain(fixtureSecret);
		expect((fixture.sqlite.prepare('SELECT status FROM backups').get() as any).status).toBe(
			'completed'
		);
		fixture.store.test(c.id);
		fixture.sqlite.exec("UPDATE notification_channels SET encrypted_secret='invalid-ciphertext'");
		const deliver = jest.fn();
		const second = new NotificationDeliveryManager(fixture.store, deliver);
		second.start();
		await second.shutdown();
		expect(deliver).not.toHaveBeenCalled();
		expect(fixture.store.deliveries().some(row => row.errorCode === 'credential-invalid')).toBe(
			true
		);
	});
});
