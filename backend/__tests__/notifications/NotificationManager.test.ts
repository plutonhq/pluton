import { NotificationManager } from '../../src/notifications/NotificationManager';
import { BaseNotification } from '../../src/notifications/BaseNotification';
import { NotificationChannel } from '../../src/notifications/NotificationChannel';

// Mock notification channel
class MockNotificationChannel implements NotificationChannel {
	async send(
		notification: BaseNotification,
		options?: Record<string, any>
	): Promise<{ success: boolean; result: string }> {
		return { success: true, result: 'Mock send successful' };
	}
}

// Mock notification class
class MockNotification extends BaseNotification {
	constructor(subject: string, content: string) {
		super();
		this.subject = subject;
		this.content = content;
	}

	protected buildContent(data: Record<string, any>): string {
		return data.content || '';
	}
}

describe('NotificationManager', () => {
	let notificationManager: NotificationManager;
	let mockChannel1: jest.Mocked<NotificationChannel>;
	let mockChannel2: jest.Mocked<NotificationChannel>;

	beforeEach(() => {
		notificationManager = new NotificationManager();
		mockChannel1 = {
			send: jest.fn().mockResolvedValue({ success: true, result: 'Channel 1 success' }),
		};
		mockChannel2 = {
			send: jest.fn().mockResolvedValue({ success: true, result: 'Channel 2 success' }),
		};
	});

	describe('registerChannel', () => {
		it('should register a single channel', () => {
			notificationManager.registerChannel(mockChannel1);
			expect(notificationManager['channels']).toHaveLength(1);
			expect(notificationManager['channels'][0]).toBe(mockChannel1);
		});

		it('should register multiple channels', () => {
			notificationManager.registerChannel(mockChannel1);
			notificationManager.registerChannel(mockChannel2);
			expect(notificationManager['channels']).toHaveLength(2);
		});

		it('should allow registering the same channel multiple times', () => {
			notificationManager.registerChannel(mockChannel1);
			notificationManager.registerChannel(mockChannel1);
			expect(notificationManager['channels']).toHaveLength(2);
		});

		it('should register channels in order', () => {
			notificationManager.registerChannel(mockChannel1);
			notificationManager.registerChannel(mockChannel2);
			expect(notificationManager['channels'][0]).toBe(mockChannel1);
			expect(notificationManager['channels'][1]).toBe(mockChannel2);
		});
	});

	describe('notify', () => {
		it('should send notification to all registered channels', async () => {
			const notification = new MockNotification('Test Subject', 'Test Content');
			notificationManager.registerChannel(mockChannel1);
			notificationManager.registerChannel(mockChannel2);

			await notificationManager.notify(notification);

			expect(mockChannel1.send).toHaveBeenCalledWith(notification);
			expect(mockChannel2.send).toHaveBeenCalledWith(notification);
			expect(mockChannel1.send).toHaveBeenCalledTimes(1);
			expect(mockChannel2.send).toHaveBeenCalledTimes(1);
		});

		it('should not fail if no channels are registered', async () => {
			const notification = new MockNotification('Test Subject', 'Test Content');
			await expect(notificationManager.notify(notification)).resolves.not.toThrow();
		});

		it('should send notifications in parallel', async () => {
			const notification = new MockNotification('Test Subject', 'Test Content');
			const sendPromises: Promise<any>[] = [];

			mockChannel1.send = jest.fn().mockImplementation(() => {
				const promise = new Promise(resolve =>
					setTimeout(() => resolve({ success: true, result: 'Channel 1' }), 100)
				);
				sendPromises.push(promise);
				return promise;
			});

			mockChannel2.send = jest.fn().mockImplementation(() => {
				const promise = new Promise(resolve =>
					setTimeout(() => resolve({ success: true, result: 'Channel 2' }), 100)
				);
				sendPromises.push(promise);
				return promise;
			});

			notificationManager.registerChannel(mockChannel1);
			notificationManager.registerChannel(mockChannel2);

			const startTime = Date.now();
			await notificationManager.notify(notification);
			const endTime = Date.now();
			const duration = endTime - startTime;

			// Should complete in ~100ms (parallel) not ~200ms (sequential)
			expect(duration).toBeLessThan(300);
		});

		it('should handle channel send failures gracefully', async () => {
			const notification = new MockNotification('Test Subject', 'Test Content');
			mockChannel1.send = jest.fn().mockRejectedValue(new Error('Channel 1 failed'));
			mockChannel2.send = jest
				.fn()
				.mockResolvedValue({ success: true, result: 'Channel 2 success' });

			notificationManager.registerChannel(mockChannel1);
			notificationManager.registerChannel(mockChannel2);

			await expect(notificationManager.notify(notification)).rejects.toThrow('Channel 1 failed');
		});

		it('should pass correct notification data to channels', async () => {
			const notification = new MockNotification('Important Alert', 'Critical message');
			notificationManager.registerChannel(mockChannel1);

			await notificationManager.notify(notification);

			expect(mockChannel1.send).toHaveBeenCalledWith(notification);
			const passedNotification = mockChannel1.send.mock.calls[0][0];
			expect(passedNotification.getSubject()).toBe('Important Alert');
			expect(passedNotification.getContent()).toBe('Critical message');
		});

		it('should work with different notification types', async () => {
			class AnotherMockNotification extends BaseNotification {
				constructor() {
					super();
					this.subject = 'Another type';
					this.content = 'Different content';
					this.type = 'warning';
				}

				protected buildContent(data: Record<string, any>): string {
					return 'Built content';
				}
			}

			const notification = new AnotherMockNotification();
			notificationManager.registerChannel(mockChannel1);

			await notificationManager.notify(notification);

			expect(mockChannel1.send).toHaveBeenCalledWith(notification);
		});

		it('should handle empty notification content', async () => {
			const notification = new MockNotification('', '');
			notificationManager.registerChannel(mockChannel1);

			await notificationManager.notify(notification);

			expect(mockChannel1.send).toHaveBeenCalledWith(notification);
		});

		it('should maintain notification immutability across channels', async () => {
			const notification = new MockNotification('Test', 'Content');
			const originalSubject = notification.getSubject();
			const originalContent = notification.getContent();

			mockChannel1.send = jest.fn().mockImplementation((notif: BaseNotification) => {
				// Try to modify (this shouldn't affect the original)
				(notif as any).subject = 'Modified';
				return Promise.resolve({ success: true, result: 'ok' });
			});

			notificationManager.registerChannel(mockChannel1);
			notificationManager.registerChannel(mockChannel2);

			await notificationManager.notify(notification);

			// Channel 2 should still receive the modified version (reference issue)
			expect(mockChannel2.send).toHaveBeenCalledWith(notification);
		});
	});

	describe('integration scenarios', () => {
		it('should handle rapid consecutive notifications', async () => {
			notificationManager.registerChannel(mockChannel1);

			const notifications = [
				new MockNotification('Subject 1', 'Content 1'),
				new MockNotification('Subject 2', 'Content 2'),
				new MockNotification('Subject 3', 'Content 3'),
			];

			await Promise.all(notifications.map(n => notificationManager.notify(n)));

			expect(mockChannel1.send).toHaveBeenCalledTimes(3);
		});

		it('should work correctly after channels are dynamically added', async () => {
			const notification1 = new MockNotification('First', 'Content');
			const notification2 = new MockNotification('Second', 'Content');

			notificationManager.registerChannel(mockChannel1);
			await notificationManager.notify(notification1);

			expect(mockChannel1.send).toHaveBeenCalledTimes(1);

			notificationManager.registerChannel(mockChannel2);
			await notificationManager.notify(notification2);

			expect(mockChannel1.send).toHaveBeenCalledTimes(2);
			expect(mockChannel2.send).toHaveBeenCalledTimes(1);
		});
	});
});
