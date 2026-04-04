import { BackupNotification } from '../../src/notifications/BackupNotification';
import { NotificationChannelResolver } from '../../src/notifications/channels/NotificationChannelResolver';
import { SlackChannel } from '../../src/notifications/channels/SlackChannel';
import { DiscordChannel } from '../../src/notifications/channels/DiscordChannel';
import { BackupStartedNotification } from '../../src/notifications/templates/email/backup/BackupStartedNotification';
import { BackupSuccessNotification } from '../../src/notifications/templates/email/backup/BackupSuccessNotification';
import { BackupFailedNotification } from '../../src/notifications/templates/email/backup/BackupFailedNotification';
import { PlanFull } from '../../src/types/plans';
import { planLogger } from '../../src/utils/logger';
import { configService } from '../../src/services/ConfigService';

// Mock dependencies
jest.mock('../../src/notifications/channels/NotificationChannelResolver');
jest.mock('../../src/notifications/channels/SlackChannel');
jest.mock('../../src/notifications/channels/DiscordChannel');
jest.mock('../../src/notifications/templates/email/backup/BackupStartedNotification');
jest.mock('../../src/notifications/templates/email/backup/BackupSuccessNotification');
jest.mock('../../src/notifications/templates/email/backup/BackupFailedNotification');
jest.mock('../../src/utils/logger');
jest.mock('../../src/services/ConfigService', () => ({
	configService: {
		config: {
			APP_TITLE: 'Test App',
		},
	},
}));

describe('BackupNotification', () => {
	let backupNotification: BackupNotification;
	let mockPlan: PlanFull;
	let mockChannel: any;
	let mockLogger: any;

	beforeEach(() => {
		jest.clearAllMocks();
		backupNotification = new BackupNotification();

		mockChannel = {
			send: jest.fn().mockResolvedValue({ success: true, result: 'Email sent' }),
		};

		mockLogger = {
			info: jest.fn(),
			error: jest.fn(),
		};

		(planLogger as jest.Mock).mockReturnValue(mockLogger);
		(NotificationChannelResolver.getChannel as jest.Mock).mockResolvedValue(mockChannel);

		mockPlan = {
			id: 'plan-123',
			title: 'Test Plan',
			method: 'snapshot',
			sourceConfig: {
				includes: ['/path/to/source'],
				excludes: ['/path/to/exclude'],
			},
			storagePath: '/backup/path',
			settings: {
				notification: {
					email: {
						enabled: true,
						emails: ['test@example.com'],
						case: 'both',
						type: 'smtp',
					},
				},
			},
			device: {
				id: 'device-1',
				name: 'Test Device',
			},
			storage: {
				id: 'storage-1',
				name: 'Test Storage',
				type: 's3',
			},
		} as any;
	});

	describe('shouldSend', () => {
		it('should return true when notificationCase is "both"', () => {
			expect(backupNotification.shouldSend('both', 'start')).toBe(true);
			expect(backupNotification.shouldSend('both', 'success')).toBe(true);
			expect(backupNotification.shouldSend('both', 'failure')).toBe(true);
		});

		it('should return true when notificationCase matches notificationType', () => {
			expect(backupNotification.shouldSend('start', 'start')).toBe(true);
			expect(backupNotification.shouldSend('success', 'success')).toBe(true);
			expect(backupNotification.shouldSend('failure', 'failure')).toBe(true);
		});

		it('should return true for success/failure when notificationCase is "end"', () => {
			expect(backupNotification.shouldSend('end', 'success')).toBe(true);
			expect(backupNotification.shouldSend('end', 'failure')).toBe(true);
		});

		it('should return false for start when notificationCase is "end"', () => {
			expect(backupNotification.shouldSend('end', 'start')).toBe(false);
		});

		it('should return false when cases do not match', () => {
			expect(backupNotification.shouldSend('start', 'success')).toBe(false);
			expect(backupNotification.shouldSend('success', 'failure')).toBe(false);
		});
	});

	describe('send', () => {
		it('should send email when email notification is enabled', async () => {
			const sendEmailSpy = jest.spyOn(backupNotification, 'sendEmail').mockResolvedValue();

			await backupNotification.send(mockPlan, 'start', { id: 'backup-1' });

			expect(sendEmailSpy).toHaveBeenCalledWith(mockPlan, 'start', { id: 'backup-1' });
		});

		it('should not send email when email notification is disabled', async () => {
			mockPlan.settings.notification!.email!.enabled = false;
			const sendEmailSpy = jest.spyOn(backupNotification, 'sendEmail');

			await backupNotification.send(mockPlan, 'start');

			expect(sendEmailSpy).not.toHaveBeenCalled();
		});

		it('should not send email when notification settings are missing', async () => {
			(mockPlan.settings as any).notification = undefined;
			const sendEmailSpy = jest.spyOn(backupNotification, 'sendEmail');

			await backupNotification.send(mockPlan, 'start');

			expect(sendEmailSpy).not.toHaveBeenCalled();
		});
		it('should handle different notification types', async () => {
			const sendEmailSpy = jest.spyOn(backupNotification, 'sendEmail').mockResolvedValue();

			await backupNotification.send(mockPlan, 'success');
			expect(sendEmailSpy).toHaveBeenCalledWith(mockPlan, 'success', undefined);

			await backupNotification.send(mockPlan, 'failure');
			expect(sendEmailSpy).toHaveBeenCalledWith(mockPlan, 'failure', undefined);
		});

		it('should send slack when slack notification is enabled', async () => {
			const sendEmailSpy = jest.spyOn(backupNotification, 'sendEmail').mockResolvedValue();
			const sendSlackSpy = jest.spyOn(backupNotification, 'sendSlack').mockResolvedValue();
			mockPlan.settings.notification!.slack = {
				enabled: true,
				case: 'both',
				url: 'https://hooks.slack.com/services/T00/B00/xxxx',
			};

			await backupNotification.send(mockPlan, 'start', { id: 'backup-1' });

			expect(sendEmailSpy).toHaveBeenCalled();
			expect(sendSlackSpy).toHaveBeenCalledWith(mockPlan, 'start', { id: 'backup-1' });
		});

		it('should send discord when discord notification is enabled', async () => {
			const sendEmailSpy = jest.spyOn(backupNotification, 'sendEmail').mockResolvedValue();
			const sendDiscordSpy = jest.spyOn(backupNotification, 'sendDiscord').mockResolvedValue();
			mockPlan.settings.notification!.discord = {
				enabled: true,
				case: 'both',
				url: 'https://discord.com/api/webhooks/1234/abcd',
			};

			await backupNotification.send(mockPlan, 'success', { id: 'backup-1' });

			expect(sendEmailSpy).toHaveBeenCalled();
			expect(sendDiscordSpy).toHaveBeenCalledWith(mockPlan, 'success', { id: 'backup-1' });
		});

		it('should not send slack when slack notification is disabled', async () => {
			jest.spyOn(backupNotification, 'sendEmail').mockResolvedValue();
			const sendSlackSpy = jest.spyOn(backupNotification, 'sendSlack');
			mockPlan.settings.notification!.slack = {
				enabled: false,
				case: 'both',
				url: 'https://hooks.slack.com/services/T00/B00/xxxx',
			};

			await backupNotification.send(mockPlan, 'start');

			expect(sendSlackSpy).not.toHaveBeenCalled();
		});

		it('should not send discord when discord notification is disabled', async () => {
			jest.spyOn(backupNotification, 'sendEmail').mockResolvedValue();
			const sendDiscordSpy = jest.spyOn(backupNotification, 'sendDiscord');
			mockPlan.settings.notification!.discord = {
				enabled: false,
				case: 'both',
				url: 'https://discord.com/api/webhooks/1234/abcd',
			};

			await backupNotification.send(mockPlan, 'start');

			expect(sendDiscordSpy).not.toHaveBeenCalled();
		});

		it('should send all channels when all are enabled', async () => {
			const sendEmailSpy = jest.spyOn(backupNotification, 'sendEmail').mockResolvedValue();
			const sendSlackSpy = jest.spyOn(backupNotification, 'sendSlack').mockResolvedValue();
			const sendDiscordSpy = jest.spyOn(backupNotification, 'sendDiscord').mockResolvedValue();
			mockPlan.settings.notification!.slack = {
				enabled: true,
				case: 'both',
				url: 'https://hooks.slack.com/services/T00/B00/xxxx',
			};
			mockPlan.settings.notification!.discord = {
				enabled: true,
				case: 'both',
				url: 'https://discord.com/api/webhooks/1234/abcd',
			};

			await backupNotification.send(mockPlan, 'start');

			expect(sendEmailSpy).toHaveBeenCalled();
			expect(sendSlackSpy).toHaveBeenCalled();
			expect(sendDiscordSpy).toHaveBeenCalled();
		});
	});

	describe('sendEmail', () => {
		it('should send email successfully', async () => {
			await backupNotification.sendEmail(mockPlan, 'start', { id: 'backup-1' });

			expect(NotificationChannelResolver.getChannel).toHaveBeenCalledWith('smtp');
			expect(mockChannel.send).toHaveBeenCalled();
			expect(mockLogger.info).toHaveBeenCalledWith(
				expect.stringContaining('Notification Email Sent Successfully')
			);
		});

		it('should not send when notification case does not match', async () => {
			mockPlan.settings.notification!.email!.case = 'end';

			await backupNotification.sendEmail(mockPlan, 'start', { id: 'backup-1' });

			expect(mockChannel.send).not.toHaveBeenCalled();
			expect(mockLogger.error).toHaveBeenCalledWith(
				expect.stringContaining('Does not match Plan Notification Case')
			);
		});

		it('should throw error when emails are missing', async () => {
			mockPlan.settings.notification!.email!.emails = '' as any;

			await backupNotification.sendEmail(mockPlan, 'start', { id: 'backup-1' });

			expect(mockChannel.send).not.toHaveBeenCalled();
			expect(mockLogger.error).toHaveBeenCalledWith(
				expect.stringContaining('Email Notification Emails Missing')
			);
		});
		it('should log error when channel send fails', async () => {
			mockChannel.send.mockResolvedValue({ success: false, result: 'Send failed' });

			await backupNotification.sendEmail(mockPlan, 'start', { id: 'backup-1' });

			expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Send failed'));
		});

		it('should handle channel errors gracefully', async () => {
			(NotificationChannelResolver.getChannel as jest.Mock).mockRejectedValue(
				new Error('Channel error')
			);

			await backupNotification.sendEmail(mockPlan, 'start', { id: 'backup-1' });

			expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Channel error'));
		});

		it('should pass correct emails to channel', async () => {
			const emails = 'user1@test.com,user2@test.com';
			mockPlan.settings.notification!.email!.emails = emails;

			await backupNotification.sendEmail(mockPlan, 'start', { id: 'backup-1' });

			expect(mockChannel.send).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({ emails })
			);
		});
	});
	describe('sendSlack', () => {
		let mockSlackChannel: any;

		beforeEach(() => {
			mockSlackChannel = {
				send: jest.fn().mockResolvedValue({ success: true, result: 'Sent' }),
			};
			(SlackChannel as jest.MockedClass<typeof SlackChannel>).mockImplementation(
				() => mockSlackChannel
			);
			mockPlan.settings.notification!.slack = {
				enabled: true,
				case: 'both',
				url: 'https://hooks.slack.com/services/T00/B00/xxxx',
			};
		});

		it('should send slack notification successfully', async () => {
			await backupNotification.sendSlack(mockPlan, 'success', { id: 'backup-1' });

			expect(SlackChannel).toHaveBeenCalledWith('https://hooks.slack.com/services/T00/B00/xxxx');
			expect(mockSlackChannel.send).toHaveBeenCalled();
			expect(mockLogger.info).toHaveBeenCalledWith(
				expect.stringContaining('Slack Notification Sent Successfully')
			);
		});

		it('should not send when notification case does not match', async () => {
			mockPlan.settings.notification!.slack!.case = 'end';

			await backupNotification.sendSlack(mockPlan, 'start', { id: 'backup-1' });

			expect(mockSlackChannel.send).not.toHaveBeenCalled();
			expect(mockLogger.error).toHaveBeenCalledWith(
				expect.stringContaining('Does not match Plan Notification Case')
			);
		});

		it('should throw error when webhook URL is missing', async () => {
			mockPlan.settings.notification!.slack!.url = '' as any;

			await backupNotification.sendSlack(mockPlan, 'success', { id: 'backup-1' });

			expect(mockSlackChannel.send).not.toHaveBeenCalled();
			expect(mockLogger.error).toHaveBeenCalledWith(
				expect.stringContaining('Slack Webhook URL Missing')
			);
		});

		it('should log error when channel send fails', async () => {
			mockSlackChannel.send.mockResolvedValue({ success: false, result: 'Send failed' });

			await backupNotification.sendSlack(mockPlan, 'success', { id: 'backup-1' });

			expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Send failed'));
		});

		it('should handle channel errors gracefully', async () => {
			mockSlackChannel.send.mockRejectedValue(new Error('Network error'));

			await backupNotification.sendSlack(mockPlan, 'success', { id: 'backup-1' });

			expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Network error'));
		});

		it('should bypass case check when notificationCase is provided', async () => {
			mockPlan.settings.notification!.slack!.case = 'end';

			await backupNotification.sendSlack(mockPlan, 'start', { id: 'backup-1' }, 'start');

			expect(mockSlackChannel.send).toHaveBeenCalled();
			expect(mockLogger.info).toHaveBeenCalledWith(
				expect.stringContaining('Slack Notification Sent Successfully')
			);
		});

		it('should pass slack as output format to getNotificationClass', async () => {
			await backupNotification.sendSlack(mockPlan, 'start', { startTime: new Date() });

			expect(BackupStartedNotification).toHaveBeenCalledWith(
				expect.objectContaining({ output: 'slack' })
			);
		});
	});

	describe('sendDiscord', () => {
		let mockDiscordChannel: any;

		beforeEach(() => {
			mockDiscordChannel = {
				send: jest.fn().mockResolvedValue({ success: true, result: 'Sent' }),
			};
			(DiscordChannel as jest.MockedClass<typeof DiscordChannel>).mockImplementation(
				() => mockDiscordChannel
			);
			mockPlan.settings.notification!.discord = {
				enabled: true,
				case: 'both',
				url: 'https://discord.com/api/webhooks/1234/abcd',
			};
		});

		it('should send discord notification successfully', async () => {
			await backupNotification.sendDiscord(mockPlan, 'success', { id: 'backup-1' });

			expect(DiscordChannel).toHaveBeenCalledWith('https://discord.com/api/webhooks/1234/abcd');
			expect(mockDiscordChannel.send).toHaveBeenCalled();
			expect(mockLogger.info).toHaveBeenCalledWith(
				expect.stringContaining('Discord Notification Sent Successfully')
			);
		});

		it('should not send when notification case does not match', async () => {
			mockPlan.settings.notification!.discord!.case = 'end';

			await backupNotification.sendDiscord(mockPlan, 'start', { id: 'backup-1' });

			expect(mockDiscordChannel.send).not.toHaveBeenCalled();
			expect(mockLogger.error).toHaveBeenCalledWith(
				expect.stringContaining('Does not match Plan Notification Case')
			);
		});

		it('should throw error when webhook URL is missing', async () => {
			mockPlan.settings.notification!.discord!.url = '' as any;

			await backupNotification.sendDiscord(mockPlan, 'success', { id: 'backup-1' });

			expect(mockDiscordChannel.send).not.toHaveBeenCalled();
			expect(mockLogger.error).toHaveBeenCalledWith(
				expect.stringContaining('Discord Webhook URL Missing')
			);
		});

		it('should log error when channel send fails', async () => {
			mockDiscordChannel.send.mockResolvedValue({ success: false, result: 'Send failed' });

			await backupNotification.sendDiscord(mockPlan, 'success', { id: 'backup-1' });

			expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Send failed'));
		});

		it('should handle channel errors gracefully', async () => {
			mockDiscordChannel.send.mockRejectedValue(new Error('Network error'));

			await backupNotification.sendDiscord(mockPlan, 'success', { id: 'backup-1' });

			expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Network error'));
		});

		it('should bypass case check when notificationCase is provided', async () => {
			mockPlan.settings.notification!.discord!.case = 'end';

			await backupNotification.sendDiscord(mockPlan, 'start', { id: 'backup-1' }, 'start');

			expect(mockDiscordChannel.send).toHaveBeenCalled();
			expect(mockLogger.info).toHaveBeenCalledWith(
				expect.stringContaining('Discord Notification Sent Successfully')
			);
		});

		it('should pass discord as output format to getNotificationClass', async () => {
			await backupNotification.sendDiscord(mockPlan, 'start', { startTime: new Date() });

			expect(BackupStartedNotification).toHaveBeenCalledWith(
				expect.objectContaining({ output: 'discord' })
			);
		});
	});

	describe('getNotificationClass', () => {
		it('should return BackupStartedNotification for start type', async () => {
			const result = await backupNotification.getNotificationClass(mockPlan, 'start', {
				startTime: new Date(),
				stats: {} as any,
			});

			expect(BackupStartedNotification).toHaveBeenCalled();
		});

		it('should return BackupSuccessNotification for success type', async () => {
			const result = await backupNotification.getNotificationClass(mockPlan, 'success', {
				startTime: new Date(),
				endTime: new Date(),
				stats: {} as any,
			});

			expect(BackupSuccessNotification).toHaveBeenCalled();
		});

		it('should return BackupFailedNotification for failure type', async () => {
			const result = await backupNotification.getNotificationClass(mockPlan, 'failure', {
				error: 'Test error',
				startTime: new Date(),
				endTime: new Date(),
				stats: {} as any,
			});

			expect(BackupFailedNotification).toHaveBeenCalled();
		});

		it('should return BackupFailedNotification for end type with error', async () => {
			const result = await backupNotification.getNotificationClass(mockPlan, 'end', {
				error: 'Test error',
				startTime: new Date(),
				endTime: new Date(),
				stats: {} as any,
			});

			expect(BackupFailedNotification).toHaveBeenCalled();
		});

		it('should return BackupSuccessNotification for end type without error', async () => {
			const result = await backupNotification.getNotificationClass(mockPlan, 'end', {
				startTime: new Date(),
				endTime: new Date(),
				stats: {} as any,
			});

			expect(BackupSuccessNotification).toHaveBeenCalled();
		});

		it('should pass correct parameters to notification class', async () => {
			const backupData = {
				startTime: new Date(),
				stats: { filesProcessed: 100 } as any,
			};

			await backupNotification.getNotificationClass(mockPlan, 'start', backupData, 'html');

			expect(BackupStartedNotification).toHaveBeenCalledWith(
				expect.objectContaining({
					appTitle: 'Test App',
					plan: mockPlan,
					deviceName: 'Test Device',
					storageName: 'Test Storage',
					storageType: 's3',
					startTime: backupData.startTime,
					stats: backupData.stats,
					output: 'html',
				})
			);
		});

		it('should handle missing device and storage names', async () => {
			const planWithoutNames = {
				...mockPlan,
				device: undefined,
				storage: undefined,
			};

			await backupNotification.getNotificationClass(planWithoutNames as any, 'start', {
				startTime: new Date(),
			});

			expect(BackupStartedNotification).toHaveBeenCalledWith(
				expect.objectContaining({
					deviceName: '',
					storageName: '',
					storageType: '',
				})
			);
		});

		it('should support different output formats', async () => {
			await backupNotification.getNotificationClass(
				mockPlan,
				'start',
				{ startTime: new Date() },
				'json'
			);

			expect(BackupStartedNotification).toHaveBeenCalledWith(
				expect.objectContaining({
					output: 'json',
				})
			);
		});
	});
});
