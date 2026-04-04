import { BackupSuccessNotification } from '../../src/notifications/templates/email/backup/BackupSuccessNotification';
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

describe('BackupSuccessNotification', () => {
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

		mockEjsRender.mockReturnValue('<div>Success content</div>');
	});

	describe('constructor', () => {
		it('should create notification with correct subject', () => {
			const notification = new BackupSuccessNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				endTime: new Date(),
			});

			expect(notification.getSubject()).toBe('Backup Complete: Test Backup Plan');
		});

		it('should default to html content type', () => {
			const notification = new BackupSuccessNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				endTime: new Date(),
			});

			expect(notification['contentType']).toBe('html');
		});

		it('should support json output format', () => {
			const notification = new BackupSuccessNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				endTime: new Date(),
				output: 'json',
			});

			expect(notification['contentType']).toBe('json');
		});
	});

	describe('buildJSONContent', () => {
		it('should build JSON content with all required fields', () => {
			const startTime = new Date();
			const endTime = new Date();
			const stats = { filesProcessed: 100, totalSize: 2048 } as any;

			const notification = new BackupSuccessNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime,
				endTime,
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
				eventName: 'backup_success',
			});
		});

		it('should include completion stats in JSON payload', () => {
			const stats = {
				filesNew: 10,
				filesChanged: 5,
				filesUnmodified: 100,
				totalFilesProcessed: 115,
				totalBytesProcessed: 2048000,
			} as any;

			const notification = new BackupSuccessNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				endTime: new Date(),
				stats,
				output: 'json',
			});

			const content = JSON.parse(notification.getContent());

			expect(content.stats).toEqual(stats);
		});
	});

	describe('buildHTMLContent', () => {
		it('should load and render EJS template', () => {
			const notification = new BackupSuccessNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				endTime: new Date(),
			});

			expect(loadBackupTemplate).toHaveBeenCalledWith('BackupSuccessNotification.ejs');
			expect(mockEjsRender).toHaveBeenCalled();
		});

		it('should pass correct data to EJS template', () => {
			const startTime = new Date('2024-01-15T10:00:00');
			const endTime = new Date('2024-01-15T11:30:00');

			const notification = new BackupSuccessNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime,
				endTime,
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

		it('should include formatter functions in template data', () => {
			const notification = new BackupSuccessNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				endTime: new Date(),
			});

			const renderCall = mockEjsRender.mock.calls[0]?.[1];
			expect(renderCall?.formatBytes).toBeDefined();
			expect(renderCall?.formatDuration).toBeDefined();
			expect(renderCall?.formatNumberToK).toBeDefined();
		});

		it('should format start and end dates correctly', () => {
			const startTime = new Date('2024-01-15T10:00:00');
			const endTime = new Date('2024-01-15T11:30:00');

			const notification = new BackupSuccessNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime,
				endTime,
			});

			const renderCall = mockEjsRender.mock.calls[0]?.[1];
			expect(renderCall?.startDate).toBeTruthy();
			expect(renderCall?.endDate).toBeTruthy();
		});

		it('should apply email template wrapper', () => {
			mockEjsRender.mockReturnValue('<p>Backup success content</p>');

			const notification = new BackupSuccessNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				endTime: new Date(),
			});

			expect(notification.getContent()).toContain('Backup success content');
		});
	});

	describe('edge cases', () => {
		it('should handle missing stats gracefully', () => {
			const notification = new BackupSuccessNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				endTime: new Date(),
				output: 'json',
			});

			const content = JSON.parse(notification.getContent());
			expect(content.stats).toBeUndefined();
		});

		it('should handle same start and end time', () => {
			const time = new Date();

			const notification = new BackupSuccessNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: time,
				endTime: time,
			});

			expect(notification.getSubject()).toBe('Backup Complete: Test Backup Plan');
		});

		it('should handle empty source config', () => {
			const planWithoutSource = {
				...mockPlan,
				sourceConfig: undefined,
			};

			const notification = new BackupSuccessNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: planWithoutSource as any,
				startTime: new Date(),
				endTime: new Date(),
				output: 'json',
			});

			const content = JSON.parse(notification.getContent());
			expect(content.planSource.included).toBe('');
			expect(content.planSource.excluded).toBe('');
		});
	});

	describe('buildSlackContent', () => {
		it('should build valid Slack Block Kit payload', () => {
			const notification = new BackupSuccessNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				endTime: new Date(),
				output: 'slack',
			});

			const content = JSON.parse(notification.getContent());
			expect(content.blocks).toBeDefined();
			expect(Array.isArray(content.blocks)).toBe(true);
		});

		it('should include header block with success emoji', () => {
			const notification = new BackupSuccessNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				endTime: new Date(),
				output: 'slack',
			});

			const content = JSON.parse(notification.getContent());
			const header = content.blocks.find((b: any) => b.type === 'header');
			expect(header).toBeDefined();
			expect(header.text.text).toContain('Backup Complete');
			expect(header.text.text).toContain(mockPlan.title);
		});

		it('should include plan details in section fields', () => {
			const notification = new BackupSuccessNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				endTime: new Date(),
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

		it('should include stats fields when provided', () => {
			const notification = new BackupSuccessNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				endTime: new Date(),
				stats: {
					total_files_processed: 100,
					total_bytes_processed: 2048000,
					total_duration: 120,
				} as any,
				output: 'slack',
			});

			const content = JSON.parse(notification.getContent());
			const section = content.blocks.find((b: any) => b.type === 'section' && b.fields);
			const fieldTexts = section.fields.map((f: any) => f.text);
			expect(fieldTexts).toEqual(
				expect.arrayContaining([
					expect.stringContaining('Files'),
					expect.stringContaining('Size'),
					expect.stringContaining('Duration'),
				])
			);
		});

		it('should include replication failures when present', () => {
			const notification = new BackupSuccessNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				endTime: new Date(),
				replicationFailures: [
					{ storageName: 'Mirror-1', storageId: 'mirror-1', error: 'Connection failed' },
				] as any,
				output: 'slack',
			});

			const content = JSON.parse(notification.getContent());
			const replicationBlock = content.blocks.find(
				(b: any) => b.type === 'section' && b.text?.text?.includes('Replication')
			);
			expect(replicationBlock).toBeDefined();
			expect(replicationBlock.text.text).toContain('Mirror-1');
		});

		it('should include View Plan button when APP_URL is set', () => {
			const notification = new BackupSuccessNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				endTime: new Date(),
				output: 'slack',
			});

			const content = JSON.parse(notification.getContent());
			const actions = content.blocks.find((b: any) => b.type === 'actions');
			expect(actions).toBeDefined();
			expect(actions.elements[0].text.text).toBe('View Plan');
			expect(actions.elements[0].url).toContain(mockPlan.id);
		});

		it('should include context block with app title', () => {
			const notification = new BackupSuccessNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				endTime: new Date(),
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
			const notification = new BackupSuccessNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				endTime: new Date(),
				output: 'discord',
			});

			const content = JSON.parse(notification.getContent());
			expect(content.embeds).toBeDefined();
			expect(content.embeds).toHaveLength(1);
		});

		it('should use green color for success', () => {
			const notification = new BackupSuccessNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				endTime: new Date(),
				output: 'discord',
			});

			const content = JSON.parse(notification.getContent());
			expect(content.embeds[0].color).toBe(0x22c55e);
		});

		it('should include plan title in embed title', () => {
			const notification = new BackupSuccessNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				endTime: new Date(),
				output: 'discord',
			});

			const content = JSON.parse(notification.getContent());
			expect(content.embeds[0].title).toContain('Backup Complete');
			expect(content.embeds[0].title).toContain(mockPlan.title);
		});

		it('should include plan details as embed fields', () => {
			const notification = new BackupSuccessNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				endTime: new Date(),
				output: 'discord',
			});

			const content = JSON.parse(notification.getContent());
			const fieldNames = content.embeds[0].fields.map((f: any) => f.name);
			expect(fieldNames).toContain('Plan');
			expect(fieldNames).toContain('Method');
			expect(fieldNames).toContain('Device');
			expect(fieldNames).toContain('Storage');
		});

		it('should include stats fields when provided', () => {
			const notification = new BackupSuccessNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				endTime: new Date(),
				stats: {
					total_files_processed: 100,
					total_bytes_processed: 2048000,
					total_duration: 120,
				} as any,
				output: 'discord',
			});

			const content = JSON.parse(notification.getContent());
			const fieldNames = content.embeds[0].fields.map((f: any) => f.name);
			expect(fieldNames).toContain('Files');
			expect(fieldNames).toContain('Size');
			expect(fieldNames).toContain('Duration');
		});

		it('should include replication failures field when present', () => {
			const notification = new BackupSuccessNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				endTime: new Date(),
				replicationFailures: [
					{ storageName: 'Mirror-1', storageId: 'mirror-1', error: 'Connection failed' },
				] as any,
				output: 'discord',
			});

			const content = JSON.parse(notification.getContent());
			const replicationField = content.embeds[0].fields.find((f: any) =>
				f.name.includes('Replication')
			);
			expect(replicationField).toBeDefined();
			expect(replicationField.value).toContain('Mirror-1');
		});

		it('should include plan URL when APP_URL is set', () => {
			const notification = new BackupSuccessNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				endTime: new Date(),
				output: 'discord',
			});

			const content = JSON.parse(notification.getContent());
			expect(content.embeds[0].url).toContain(mockPlan.id);
		});

		it('should include footer with app title', () => {
			const notification = new BackupSuccessNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime: new Date(),
				endTime: new Date(),
				output: 'discord',
			});

			const content = JSON.parse(notification.getContent());
			expect(content.embeds[0].footer.text).toBe('Test App');
		});

		it('should include ISO timestamp', () => {
			const startTime = new Date('2024-01-15T10:00:00Z');
			const notification = new BackupSuccessNotification({
				appTitle: 'Test App',
				deviceName: 'Test Device',
				storageName: 'Test Storage',
				storageType: 's3',
				plan: mockPlan,
				startTime,
				endTime: new Date(),
				output: 'discord',
			});

			const content = JSON.parse(notification.getContent());
			expect(content.embeds[0].timestamp).toBe(startTime.toISOString());
		});
	});
});
