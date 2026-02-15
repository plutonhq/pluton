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
});
