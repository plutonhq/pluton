import { BackupFailedNotification } from '../../src/notifications/templates/email/backup/BackupFailedNotification';
import { Plan } from '../../src/db/schema/plans';
import { configService } from '../../src/services/ConfigService';
import { loadBackupTemplate } from '../../src/notifications/templateLoader';
import ejs from 'ejs';

// Mock dependencies
jest.mock('ejs');
jest.mock('../../src/services/ConfigService', () => ({
	configService: {
		config: {
			APP_TITLE: 'Test App',
			APP_URL: 'http://test.com',
		},
	},
}));

describe('BackupFailedNotification', () => {
	let mockPlan: Plan;
	const mockEjsRender = ejs.render as jest.MockedFunction<typeof ejs.render>;

	beforeEach(() => {
		jest.clearAllMocks();

		mockPlan = {
			id: 'plan-123',
			title: 'Test Backup Plan',
			method: 'snapshot',
			sourceConfig: {
				includes: ['/path/to/source'],
				excludes: ['/path/to/exclude'],
			},
			storagePath: '/backup/path',
			settings: {},
		} as any;

		mockEjsRender.mockReturnValue('<div>Failed content</div>');
	});

	describe('constructor', () => {
		it('should create notification with correct subject', () => {
			const notification = new BackupFailedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				endTime: new Date(),
				error: 'Connection timeout',
			});

			expect(notification.getSubject()).toBe('Backup Failed: Test Backup Plan');
		});

		it('should default to html content type', () => {
			const notification = new BackupFailedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				endTime: new Date(),
				error: 'Error message',
			});

			expect(notification['contentType']).toBe('html');
		});

		it('should support json output format', () => {
			const notification = new BackupFailedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				endTime: new Date(),
				error: 'Error message',
				output: 'json',
			});

			expect(notification['contentType']).toBe('json');
		});
	});

	describe('buildJSONContent', () => {
		it('should build JSON content with all required fields', () => {
			const startTime = new Date();
			const endTime = new Date();
			const error = 'Backup failed: Connection timeout';

			const notification = new BackupFailedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime,
				endTime,
				error,
				output: 'json',
			});

			const content = JSON.parse(notification.getContent());

			expect(content).toMatchObject({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				planID: 'plan-123',
				planTitle: 'Test Backup Plan',
				planType: 'snapshot',
				error: 'Backup failed: Connection timeout',
				eventName: 'backup_failed',
			});
		});

		it('should include error message in JSON payload', () => {
			const error = 'Fatal error: Disk full';

			const notification = new BackupFailedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				endTime: new Date(),
				error,
				output: 'json',
			});

			const content = JSON.parse(notification.getContent());

			expect(content.error).toBe(error);
		});

		it('should include stats if provided', () => {
			const stats = {
				filesProcessed: 50,
				totalSize: 1024000,
			} as any;

			const notification = new BackupFailedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				endTime: new Date(),
				error: 'Error',
				stats,
				output: 'json',
			});

			const content = JSON.parse(notification.getContent());

			expect(content.stats).toEqual(stats);
		});
	});

	describe('buildHTMLContent', () => {
		it('should load and render EJS template', () => {
			const notification = new BackupFailedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				endTime: new Date(),
				error: 'Error message',
			});

			expect(loadBackupTemplate).toHaveBeenCalledWith('BackupFailedNotification.ejs');
			expect(mockEjsRender).toHaveBeenCalled();
		});

		it('should pass error message to EJS template', () => {
			const error = 'Critical error: Permission denied';

			const notification = new BackupFailedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				endTime: new Date(),
				error,
			});

			expect(mockEjsRender).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					error,
					appUrl: 'http://test.com',
				})
			);
		});

		it('should include formatter functions in template data', () => {
			const notification = new BackupFailedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				endTime: new Date(),
				error: 'Error',
			});

			const renderCall = mockEjsRender.mock.calls[0]?.[1];
			expect(renderCall?.formatBytes).toBeDefined();
			expect(renderCall?.formatDuration).toBeDefined();
			expect(renderCall?.formatNumberToK).toBeDefined();
		});

		it('should apply email template wrapper with error styling', () => {
			mockEjsRender.mockReturnValue('<p>Backup failed content</p>');

			const notification = new BackupFailedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				endTime: new Date(),
				error: 'Error',
			});

			expect(notification.getContent()).toContain('Backup failed content');
		});
	});

	describe('edge cases', () => {
		it('should handle empty error message', () => {
			const notification = new BackupFailedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				endTime: new Date(),
				error: '',
			});

			expect(notification.getSubject()).toBe('Backup Failed: Test Backup Plan');
		});

		it('should handle very long error messages', () => {
			const longError = 'Error: ' + 'x'.repeat(1000);

			const notification = new BackupFailedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				endTime: new Date(),
				error: longError,
				output: 'json',
			});

			const content = JSON.parse(notification.getContent());
			expect(content.error).toBe(longError);
		});

		it('should handle multiline error messages', () => {
			const multilineError = 'Error line 1\nError line 2\nError line 3';

			const notification = new BackupFailedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				endTime: new Date(),
				error: multilineError,
			});

			expect(mockEjsRender).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					error: multilineError,
				})
			);
		});

		it('should handle missing stats', () => {
			const notification = new BackupFailedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				endTime: new Date(),
				error: 'Error',
				output: 'json',
			});

			const content = JSON.parse(notification.getContent());
			expect(content.stats).toBeUndefined();
		});
	});

	describe('buildSlackContent', () => {
		it('should build valid Slack Block Kit payload', () => {
			const notification = new BackupFailedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				endTime: new Date(),
				error: 'Connection timeout',
				output: 'slack',
			});

			const content = JSON.parse(notification.getContent());
			expect(content.blocks).toBeDefined();
			expect(Array.isArray(content.blocks)).toBe(true);
		});

		it('should include header block with failure emoji', () => {
			const notification = new BackupFailedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				endTime: new Date(),
				error: 'Connection timeout',
				output: 'slack',
			});

			const content = JSON.parse(notification.getContent());
			const header = content.blocks.find((b: any) => b.type === 'header');
			expect(header).toBeDefined();
			expect(header.text.text).toContain('Backup Failed');
			expect(header.text.text).toContain(mockPlan.title);
		});

		it('should include error message in code block', () => {
			const notification = new BackupFailedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				endTime: new Date(),
				error: 'Connection timeout',
				output: 'slack',
			});

			const content = JSON.parse(notification.getContent());
			const errorBlock = content.blocks.find(
				(b: any) => b.type === 'section' && b.text?.text?.includes('Error')
			);
			expect(errorBlock).toBeDefined();
			expect(errorBlock.text.text).toContain('Connection timeout');
		});

		it('should include plan details in section fields', () => {
			const notification = new BackupFailedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				endTime: new Date(),
				error: 'Error',
				output: 'slack',
			});

			const content = JSON.parse(notification.getContent());
			const section = content.blocks.find((b: any) => b.type === 'section' && b.fields);
			expect(section).toBeDefined();
			const fieldTexts = section.fields.map((f: any) => f.text);
			expect(fieldTexts).toEqual(
				expect.arrayContaining([
					expect.stringContaining('Test Backup Plan'),
					expect.stringContaining('Test Device'),
				])
			);
		});

		it('should include View Plan button when APP_URL is set', () => {
			const notification = new BackupFailedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				endTime: new Date(),
				error: 'Error',
				output: 'slack',
			});

			const content = JSON.parse(notification.getContent());
			const actions = content.blocks.find((b: any) => b.type === 'actions');
			expect(actions).toBeDefined();
			expect(actions.elements[0].url).toContain(mockPlan.id);
		});
	});

	describe('buildDiscordContent', () => {
		it('should build valid Discord embed payload', () => {
			const notification = new BackupFailedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				endTime: new Date(),
				error: 'Connection timeout',
				output: 'discord',
			});

			const content = JSON.parse(notification.getContent());
			expect(content.embeds).toBeDefined();
			expect(content.embeds).toHaveLength(1);
		});

		it('should use red color for failure', () => {
			const notification = new BackupFailedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				endTime: new Date(),
				error: 'Error',
				output: 'discord',
			});

			const content = JSON.parse(notification.getContent());
			expect(content.embeds[0].color).toBe(0xef4444);
		});

		it('should include error in embed fields', () => {
			const notification = new BackupFailedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				endTime: new Date(),
				error: 'Connection timeout',
				output: 'discord',
			});

			const content = JSON.parse(notification.getContent());
			const errorField = content.embeds[0].fields.find((f: any) => f.name === 'Error');
			expect(errorField).toBeDefined();
			expect(errorField.value).toContain('Connection timeout');
		});

		it('should include plan title in embed title', () => {
			const notification = new BackupFailedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				endTime: new Date(),
				error: 'Error',
				output: 'discord',
			});

			const content = JSON.parse(notification.getContent());
			expect(content.embeds[0].title).toContain('Backup Failed');
			expect(content.embeds[0].title).toContain(mockPlan.title);
		});

		it('should include footer with app title', () => {
			const notification = new BackupFailedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				endTime: new Date(),
				error: 'Error',
				output: 'discord',
			});

			const content = JSON.parse(notification.getContent());
			expect(content.embeds[0].footer.text).toBe('Test App');
		});
	});
});
