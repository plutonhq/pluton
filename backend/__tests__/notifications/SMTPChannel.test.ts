import { SMTPChannel } from '../../src/notifications/channels/SMTPChannel';
import { BaseNotification } from '../../src/notifications/BaseNotification';
import { SmtpSettings } from '../../src/types/settings';
import nodemailer from 'nodemailer';

// Mock nodemailer
jest.mock('nodemailer');

// Mock notification for testing
class MockNotification extends BaseNotification {
	constructor() {
		super();
		this.subject = 'Test Subject';
		this.content = '<p>Test Content</p>';
	}

	protected buildContent(data: Record<string, any>): string {
		return data.content || '';
	}
}

describe('SMTPChannel', () => {
	let smtpChannel: SMTPChannel;
	let mockSmtpSettings: SmtpSettings;
	let mockTransporter: any;

	beforeEach(() => {
		jest.clearAllMocks();

		mockSmtpSettings = {
			server: 'smtp.example.com',
			port: 587,
			username: 'user@example.com',
			password: 'password123',
			senderEmail: 'sender@example.com',
			senderName: 'Test Sender',
			connected: true,
		};

		mockTransporter = {
			sendMail: jest.fn().mockResolvedValue({
				messageId: 'test-message-id',
				response: '250 OK',
			}),
			options: {
				from: 'Test Sender <sender@example.com>',
				to: 'default@example.com',
			},
		};

		(nodemailer.createTransport as jest.Mock).mockReturnValue(mockTransporter);

		smtpChannel = new SMTPChannel(mockSmtpSettings);
	});

	describe('constructor', () => {
		it('should create instance with smtp settings', () => {
			expect(smtpChannel).toBeInstanceOf(SMTPChannel);
			expect(smtpChannel['smtpSettings']).toEqual(mockSmtpSettings);
		});

		it('should not initialize transporter in constructor', () => {
			expect(nodemailer.createTransport).not.toHaveBeenCalled();
		});
	});

	describe('initialize', () => {
		it('should create transporter with correct settings', async () => {
			await smtpChannel.initialize();

			expect(nodemailer.createTransport).toHaveBeenCalledWith({
				host: 'smtp.example.com',
				port: 587,
				secure: false,
				requireTLS: false,
				greetingTimeout: 10000,
				auth: {
					user: 'user@example.com',
					pass: 'password123',
				},
				tls: {
					rejectUnauthorized: false,
				},
				from: 'Test Sender <sender@example.com>',
			});
		});

		it('should use secure connection for port 465', async () => {
			mockSmtpSettings.port = 465;
			smtpChannel = new SMTPChannel(mockSmtpSettings);

			await smtpChannel.initialize();

			expect(nodemailer.createTransport).toHaveBeenCalledWith(
				expect.objectContaining({
					port: 465,
					secure: true,
				})
			);
		});

		it('should use default sender name if not provided', async () => {
			mockSmtpSettings.senderName = undefined;
			smtpChannel = new SMTPChannel(mockSmtpSettings);

			await smtpChannel.initialize();

			expect(nodemailer.createTransport).toHaveBeenCalledWith(
				expect.objectContaining({
					from: 'Pluton Backup <sender@example.com>',
				})
			);
		});

		it('should disable certificate verification', async () => {
			await smtpChannel.initialize();

			expect(nodemailer.createTransport).toHaveBeenCalledWith(
				expect.objectContaining({
					tls: {
						rejectUnauthorized: false,
					},
				})
			);
		});
	});

	describe('send', () => {
		it('should send email successfully', async () => {
			const notification = new MockNotification();
			const options = { emails: ['test@example.com'] };

			const result = await smtpChannel.send(notification, options);

			expect(result).toEqual({
				success: true,
				result: 'Email sent successfully to test@example.com',
			});
			expect(mockTransporter.sendMail).toHaveBeenCalled();
		});

		it('should initialize transporter if not already initialized', async () => {
			const notification = new MockNotification();
			const options = { emails: ['test@example.com'] };

			await smtpChannel.send(notification, options);

			expect(nodemailer.createTransport).toHaveBeenCalled();
		});

		it('should send to multiple recipients', async () => {
			const notification = new MockNotification();
			const options = { emails: ['user1@test.com', 'user2@test.com'] };

			await smtpChannel.send(notification, options);

			expect(mockTransporter.sendMail).toHaveBeenCalledWith(
				expect.objectContaining({
					to: ['user1@test.com', 'user2@test.com'],
				})
			);
		});

		it('should use default recipient if emails not provided in options', async () => {
			const notification = new MockNotification();

			await smtpChannel.send(notification, {});

			expect(mockTransporter.sendMail).toHaveBeenCalledWith(
				expect.objectContaining({
					to: 'default@example.com',
				})
			);
		});

		it('should return error on send failure', async () => {
			mockTransporter.sendMail.mockRejectedValue(new Error('Connection failed'));

			const notification = new MockNotification();
			const options = { emails: ['test@example.com'] };

			const result = await smtpChannel.send(notification, options);

			expect(result).toEqual({
				success: false,
				result: 'Connection failed',
			});
		});

		it('should handle unknown errors', async () => {
			mockTransporter.sendMail.mockRejectedValue('Unknown error');

			const notification = new MockNotification();
			const options = { emails: ['test@example.com'] };

			const result = await smtpChannel.send(notification, options);

			expect(result).toEqual({
				success: false,
				result: 'Failed to send email',
			});
		});

		it('should handle empty subject and content', async () => {
			class EmptyNotification extends BaseNotification {
				constructor() {
					super();
					this.subject = '';
					this.content = '';
				}

				protected buildContent(data: Record<string, any>): string {
					return '';
				}
			}

			const notification = new EmptyNotification();
			const options = { emails: ['test@example.com'] };

			await smtpChannel.send(notification, options);

			expect(mockTransporter.sendMail).toHaveBeenCalledWith(
				expect.objectContaining({
					subject: '',
					html: '',
				})
			);
		});

		it('should preserve HTML formatting in content', async () => {
			class HTMLNotification extends BaseNotification {
				constructor() {
					super();
					this.subject = 'HTML Test';
					this.content = '<div><h1>Title</h1><p>Content</p></div>';
				}

				protected buildContent(data: Record<string, any>): string {
					return '';
				}
			}

			const notification = new HTMLNotification();
			const options = { emails: ['test@example.com'] };

			await smtpChannel.send(notification, options);

			expect(mockTransporter.sendMail).toHaveBeenCalledWith(
				expect.objectContaining({
					html: '<div><h1>Title</h1><p>Content</p></div>',
				})
			);
		});

		it('should reuse existing transporter on subsequent sends', async () => {
			const notification = new MockNotification();
			const options = { emails: ['test@example.com'] };

			await smtpChannel.send(notification, options);
			await smtpChannel.send(notification, options);

			expect(nodemailer.createTransport).toHaveBeenCalledTimes(1);
			expect(mockTransporter.sendMail).toHaveBeenCalledTimes(2);
		});
	});

	describe('error handling', () => {
		it('should handle authentication errors', async () => {
			mockTransporter.sendMail.mockRejectedValue(new Error('Invalid login'));

			const notification = new MockNotification();
			const options = { emails: ['test@example.com'] };

			const result = await smtpChannel.send(notification, options);

			expect(result.success).toBe(false);
			expect(result.result).toContain('Invalid login');
		});

		it('should handle connection timeout', async () => {
			mockTransporter.sendMail.mockRejectedValue(new Error('Connection timeout'));

			const notification = new MockNotification();
			const options = { emails: ['test@example.com'] };

			const result = await smtpChannel.send(notification, options);

			expect(result.success).toBe(false);
			expect(result.result).toContain('Connection timeout');
		});

		it('should handle invalid recipient errors', async () => {
			mockTransporter.sendMail.mockRejectedValue(new Error('Invalid recipient'));

			const notification = new MockNotification();
			const options = { emails: ['invalid-email'] };

			const result = await smtpChannel.send(notification, options);

			expect(result.success).toBe(false);
			expect(result.result).toContain('Invalid recipient');
		});
	});
});
