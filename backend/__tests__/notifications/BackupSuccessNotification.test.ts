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
});
