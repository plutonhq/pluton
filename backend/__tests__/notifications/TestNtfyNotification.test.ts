import { TestNtfyNotification } from '../../src/notifications/templates/push/test-ntfy/TestNtfyNotification';

// Mock dependencies
jest.mock('../../src/services/ConfigService', () => ({
	configService: {
		config: {
			APP_TITLE: 'Test App',
			APP_URL: 'http://test.com',
		},
	},
}));

describe('TestNtfyNotification', () => {
	describe('constructor', () => {
		it('should create notification with ntfy integration type', () => {
			const notification = new TestNtfyNotification({
				integrationType: 'ntfy',
				appTitle: 'Test App',
			});

			expect(notification.getSubject()).toBe('Ntfy Integration Successful');
		});

		it('should set integration name from INTEGRATIONS_AVAILABLE', () => {
			const notification = new TestNtfyNotification({
				integrationType: 'ntfy',
				appTitle: 'Test App',
			});

			expect(notification['integrationName']).toBe('Ntfy');
		});
	});

	describe('buildContent', () => {
		it('should use configured APP_TITLE in content', () => {
			const notification = new TestNtfyNotification({
				integrationType: 'ntfy',
				appTitle: 'Custom App',
			});

			const content = notification.getContent();

			expect(content).toContain('Test App'); // from configService mock
			expect(content).toContain('Ntfy');
		});

		it('should return plain text content (not HTML)', () => {
			const notification = new TestNtfyNotification({
				integrationType: 'ntfy',
				appTitle: 'Test App',
			});

			const content = notification.getContent();

			// Should be plain text, not wrapped in HTML
			expect(content).not.toContain('<div');
			expect(content).not.toContain('<h2');
			expect(content).toContain('can successfully send push notifications using Ntfy');
		});

		it('should fallback to Pluton when APP_TITLE is not configured', () => {
			// Temporarily override the mock
			const configModule = require('../../src/services/ConfigService');
			const originalTitle = configModule.configService.config.APP_TITLE;
			configModule.configService.config.APP_TITLE = '';

			const notification = new TestNtfyNotification({
				integrationType: 'ntfy',
				appTitle: 'Pluton',
			});

			const content = notification.getContent();
			expect(content).toContain('Pluton');

			// Restore
			configModule.configService.config.APP_TITLE = originalTitle;
		});
	});
});
