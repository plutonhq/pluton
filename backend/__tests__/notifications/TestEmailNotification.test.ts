import { TestEmailNotification } from '../../src/notifications/templates/email/test-email/TestEmailNotification';
import { IntegrationTypes } from '../../src/types/settings';
import { configService } from '../../src/services/ConfigService';

// Mock dependencies
jest.mock('../../src/services/ConfigService', () => ({
	configService: {
		config: {
			APP_TITLE: 'Test App',
			APP_URL: 'http://test.com',
		},
	},
}));

describe('TestEmailNotification', () => {
	describe('constructor', () => {
		it('should create notification with SMTP integration', () => {
			const notification = new TestEmailNotification({
				integrationType: 'smtp',
				appTitle: 'Test App',
			});

			expect(notification.getSubject()).toBe('SMTP Integration Successful');
		});

		it('should create notification with SendGrid integration', () => {
			const notification = new TestEmailNotification({
				integrationType: 'sendgrid',
				appTitle: 'Test App',
			});

			expect(notification.getSubject()).toBe('SendGrid Integration Successful');
		});

		it('should create notification with Mailgun integration', () => {
			const notification = new TestEmailNotification({
				integrationType: 'mailgun',
				appTitle: 'Test App',
			});

			expect(notification.getSubject()).toBe('Mailgun Integration Successful');
		});

		it('should create notification with Brevo integration', () => {
			const notification = new TestEmailNotification({
				integrationType: 'brevo',
				appTitle: 'Test App',
			});

			expect(notification.getSubject()).toBe('Brevo Integration Successful');
		});

		it('should create notification with AWS SES integration', () => {
			const notification = new TestEmailNotification({
				integrationType: 'awsSes',
				appTitle: 'Test App',
			});

			expect(notification.getSubject()).toBe('AWS SES Integration Successful');
		});

		it('should create notification with Resend integration', () => {
			const notification = new TestEmailNotification({
				integrationType: 'resend',
				appTitle: 'Test App',
			});

			expect(notification.getSubject()).toBe('Resend Integration Successful');
		});

		it('should create notification with Ntfy integration', () => {
			const notification = new TestEmailNotification({
				integrationType: 'ntfy',
				appTitle: 'Test App',
			});

			expect(notification.getSubject()).toBe('Ntfy Integration Successful');
		});
	});

	describe('buildContent', () => {
		it('should use configured APP_TITLE in content', () => {
			const notification = new TestEmailNotification({
				integrationType: 'smtp',
				appTitle: 'Custom App',
			});

			const content = notification.getContent();

			expect(content).toContain('Test App'); // from configService
		});

		it('should contain centered content div', () => {
			const notification = new TestEmailNotification({
				integrationType: 'smtp',
				appTitle: 'Test App',
			});

			const content = notification.getContent();

			expect(content).toContain('class="center"');
			expect(content).toContain('<h2>');
			expect(content).toContain('<p>');
		});

		it('should apply email template wrapper', () => {
			const notification = new TestEmailNotification({
				integrationType: 'sendgrid',
				appTitle: 'Test App',
			});

			const content = notification.getContent();

			// Should be wrapped in email template
			expect(content).toBeTruthy();
			expect(content.length).toBeGreaterThan(100); // Template adds significant content
		});
	});

	describe('integration name mapping', () => {
		it('should correctly map smtp to SMTP', () => {
			const notification = new TestEmailNotification({
				integrationType: 'smtp',
				appTitle: 'Test App',
			});

			expect(notification['integrationName']).toBe('SMTP');
		});

		it('should correctly map sendgrid to SendGrid', () => {
			const notification = new TestEmailNotification({
				integrationType: 'sendgrid',
				appTitle: 'Test App',
			});

			expect(notification['integrationName']).toBe('SendGrid');
		});

		it('should correctly map mailgun to Mailgun', () => {
			const notification = new TestEmailNotification({
				integrationType: 'mailgun',
				appTitle: 'Test App',
			});

			expect(notification['integrationName']).toBe('Mailgun');
		});

		it('should correctly map brevo to Brevo', () => {
			const notification = new TestEmailNotification({
				integrationType: 'brevo',
				appTitle: 'Test App',
			});

			expect(notification['integrationName']).toBe('Brevo');
		});

		it('should correctly map awsSes to AWS SES', () => {
			const notification = new TestEmailNotification({
				integrationType: 'awsSes',
				appTitle: 'Test App',
			});

			expect(notification['integrationName']).toBe('AWS SES');
		});

		it('should correctly map resend to Resend', () => {
			const notification = new TestEmailNotification({
				integrationType: 'resend',
				appTitle: 'Test App',
			});

			expect(notification['integrationName']).toBe('Resend');
		});

		it('should correctly map ntfy to Ntfy', () => {
			const notification = new TestEmailNotification({
				integrationType: 'ntfy',
				appTitle: 'Test App',
			});

			expect(notification['integrationName']).toBe('Ntfy');
		});
	});

	describe('subject line', () => {
		it('should include integration name in subject', () => {
			const notification = new TestEmailNotification({
				integrationType: 'smtp',
				appTitle: 'Test App',
			});

			expect(notification.getSubject()).toContain('SMTP');
			expect(notification.getSubject()).toContain('Integration Successful');
		});

		it('should have consistent subject format across integrations', () => {
			const integrations: IntegrationTypes[] = [
				'smtp',
				'sendgrid',
				'mailgun',
				'brevo',
				'awsSes',
				'resend',
				'ntfy',
			];

			integrations.forEach(integrationType => {
				const notification = new TestEmailNotification({
					integrationType,
					appTitle: 'Test App',
				});

				expect(notification.getSubject()).toMatch(/^.+ Integration Successful$/);
			});
		});
	});

	describe('inheritance from BaseNotification', () => {
		it('should have timestamp', () => {
			const notification = new TestEmailNotification({
				integrationType: 'smtp',
				appTitle: 'Test App',
			});

			expect(notification.getTimestamp()).toBeInstanceOf(Date);
		});

		it('should have type set', () => {
			const notification = new TestEmailNotification({
				integrationType: 'smtp',
				appTitle: 'Test App',
			});

			expect(notification.getType()).toBe('test');
		});
	});
});
