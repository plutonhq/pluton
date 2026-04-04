import { BackupStartedNotification } from '../../src/notifications/templates/email/backup/BackupStartedNotification';
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

describe('BackupStartedNotification', () => {
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

		mockEjsRender.mockReturnValue('<div>Rendered content</div>');
	});

	describe('constructor and content building', () => {
		it('should create notification with correct subject', () => {
			const notification = new BackupStartedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
			});

			expect(notification.getSubject()).toBe('Backup Started: Test Backup Plan');
		});

		it('should default to html content type', () => {
			const notification = new BackupStartedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
			});

			expect(notification['contentType']).toBe('html');
		});

		it('should support json output format', () => {
			const notification = new BackupStartedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				output: 'json',
			});

			expect(notification['contentType']).toBe('json');
		});

		it('should build content on construction', () => {
			const notification = new BackupStartedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
			});

			expect(notification.getContent()).toBeTruthy();
		});
	});

	describe('buildJSONContent', () => {
		it('should build JSON content with all required fields', () => {
			const startTime = new Date();
			const stats = { filesProcessed: 100 } as any;

			const notification = new BackupStartedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime,
				stats,
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
				eventName: 'backup_started',
			});
		});

		it('should include stats in JSON payload', () => {
			const stats = { filesProcessed: 50, totalSize: 1024 } as any;

			const notification = new BackupStartedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				stats,
				output: 'json',
			});

			const content = JSON.parse(notification.getContent());

			expect(content.stats).toEqual(stats);
		});

		it('should format source includes and excludes', () => {
			const notification = new BackupStartedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				output: 'json',
			});

			const content = JSON.parse(notification.getContent());

			expect(content.planSource.included).toBe('/path/to/source');
			expect(content.planSource.excluded).toBe('/path/to/exclude');
		});

		it('should handle empty source config', () => {
			const planWithoutSource = {
				...mockPlan,
				sourceConfig: undefined,
			};

			const notification = new BackupStartedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: planWithoutSource as any,
				startTime: new Date(),
				output: 'json',
			});

			const content = JSON.parse(notification.getContent());

			expect(content.planSource.included).toBe('');
			expect(content.planSource.excluded).toBe('');
		});
	});

	describe('buildHTMLContent', () => {
		it('should load and render EJS template', () => {
			const notification = new BackupStartedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
			});

			expect(loadBackupTemplate).toHaveBeenCalledWith('BackupStartedNotification.ejs');
			expect(mockEjsRender).toHaveBeenCalled();
		});

		it('should pass correct data to EJS template', () => {
			const startTime = new Date('2024-01-15T10:30:00');

			const notification = new BackupStartedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime,
			});

			expect(mockEjsRender).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					appUrl: 'http://test.com',
					deviceName: 'Test Device',
					storageName: 'Test Storage',
					plan: mockPlan,
				})
			);
		});

		it('should format start date correctly', () => {
			const startTime = new Date('2024-01-15T10:30:00');

			const notification = new BackupStartedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime,
			});

			const renderCall = mockEjsRender.mock.calls[0]?.[1];
			expect(renderCall?.startDate).toBeTruthy();
		});

		it('should include formatter functions in template data', () => {
			const notification = new BackupStartedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
			});

			const renderCall = mockEjsRender.mock.calls[0]?.[1];
			expect(renderCall?.formatBytes).toBeDefined();
			expect(renderCall?.formatNumberToK).toBeDefined();
		});

		it('should apply email template wrapper', () => {
			mockEjsRender.mockReturnValue('<p>Backup started content</p>');

			const notification = new BackupStartedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
			});

			// The content should be wrapped in email template
			expect(notification.getContent()).toContain('Backup started content');
		});

		it('should map storage type to provider name', () => {
			const notification = new BackupStartedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
			});

			const renderCall = mockEjsRender.mock.calls[0]?.[1];
			expect(renderCall?.storageTypeName).toBeTruthy();
		});
	});

	describe('edge cases', () => {
		it('should handle missing stats gracefully', () => {
			const notification = new BackupStartedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				output: 'json',
			});

			const content = JSON.parse(notification.getContent());
			expect(content.stats).toBeUndefined();
		});

		it('should handle empty device and storage names', () => {
			const notification = new BackupStartedNotification({
				appTitle: 'Test App',
				deviceName: '',
				storageName: '',
				storageType: '',
				plan: mockPlan,
				startTime: new Date(),
			});

			expect(notification.getSubject()).toBe('Backup Started: Test Backup Plan');
		});

		it('should handle very long plan titles', () => {
			const longPlan = {
				...mockPlan,
				title: 'A'.repeat(200),
			};

			const notification = new BackupStartedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: longPlan as any,
				startTime: new Date(),
			});

			expect(notification.getSubject()).toContain('A'.repeat(200));
		});

		it('should handle missing storage path', () => {
			const planWithoutPath = {
				...mockPlan,
				storagePath: undefined,
			};

			const notification = new BackupStartedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: planWithoutPath as any,
				startTime: new Date(),
				output: 'json',
			});

			const content = JSON.parse(notification.getContent());
			expect(content.storagePath).toBe('');
		});
	});

	describe('buildSlackContent', () => {
		it('should build valid Slack Block Kit payload', () => {
			const notification = new BackupStartedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				output: 'slack',
			});

			const content = JSON.parse(notification.getContent());
			expect(content.blocks).toBeDefined();
			expect(Array.isArray(content.blocks)).toBe(true);
		});

		it('should include header block with started emoji', () => {
			const notification = new BackupStartedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				output: 'slack',
			});

			const content = JSON.parse(notification.getContent());
			const header = content.blocks.find((b: any) => b.type === 'header');
			expect(header).toBeDefined();
			expect(header.text.text).toContain('Backup Started');
			expect(header.text.text).toContain(mockPlan.title);
		});

		it('should include plan details in section fields', () => {
			const notification = new BackupStartedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
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
					expect.stringContaining('Test Storage'),
				])
			);
		});

		it('should include View Plan button when APP_URL is set', () => {
			const notification = new BackupStartedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				output: 'slack',
			});

			const content = JSON.parse(notification.getContent());
			const actions = content.blocks.find((b: any) => b.type === 'actions');
			expect(actions).toBeDefined();
			expect(actions.elements[0].url).toContain(mockPlan.id);
		});

		it('should include context with app title', () => {
			const notification = new BackupStartedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				output: 'slack',
			});

			const content = JSON.parse(notification.getContent());
			const context = content.blocks.find((b: any) => b.type === 'context');
			expect(context).toBeDefined();
			expect(context.elements[0].text).toContain('Test App');
		});
	});

	describe('buildDiscordContent', () => {
		it('should build valid Discord embed payload', () => {
			const notification = new BackupStartedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				output: 'discord',
			});

			const content = JSON.parse(notification.getContent());
			expect(content.embeds).toBeDefined();
			expect(content.embeds).toHaveLength(1);
		});

		it('should use blue color for started', () => {
			const notification = new BackupStartedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				output: 'discord',
			});

			const content = JSON.parse(notification.getContent());
			expect(content.embeds[0].color).toBe(0x3b82f6);
		});

		it('should include plan details as embed fields', () => {
			const notification = new BackupStartedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				output: 'discord',
			});

			const content = JSON.parse(notification.getContent());
			const fieldNames = content.embeds[0].fields.map((f: any) => f.name);
			expect(fieldNames).toContain('Plan');
			expect(fieldNames).toContain('Method');
			expect(fieldNames).toContain('Device');
			expect(fieldNames).toContain('Storage');
		});

		it('should include plan URL when APP_URL is set', () => {
			const notification = new BackupStartedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				output: 'discord',
			});

			const content = JSON.parse(notification.getContent());
			expect(content.embeds[0].url).toContain(mockPlan.id);
		});

		it('should include footer with app title', () => {
			const notification = new BackupStartedNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				output: 'discord',
			});

			const content = JSON.parse(notification.getContent());
			expect(content.embeds[0].footer.text).toBe('Test App');
		});
	});
});
