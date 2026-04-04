import { SlackChannel } from '../../src/notifications/channels/SlackChannel';
import { BaseNotification } from '../../src/notifications/BaseNotification';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock notification for testing
class MockNotification extends BaseNotification {
	constructor(content: string = '{"text":"Test message"}', subject: string = 'Test Subject') {
		super();
		this.subject = subject;
		this.content = content;
	}

	protected buildContent(): string {
		return '';
	}
}

describe('SlackChannel', () => {
	let slackChannel: SlackChannel;
	const webhookUrl = 'https://hooks.slack.com/services/T00/B00/xxxx';

	beforeEach(() => {
		jest.clearAllMocks();
		slackChannel = new SlackChannel(webhookUrl);
	});

	describe('constructor', () => {
		it('should create instance with webhook URL', () => {
			expect(slackChannel).toBeInstanceOf(SlackChannel);
			expect(slackChannel['webhookUrl']).toBe(webhookUrl);
		});
	});

	describe('send', () => {
		it('should send notification successfully with JSON content', async () => {
			mockFetch.mockResolvedValue({
				ok: true,
				text: jest.fn().mockResolvedValue('ok'),
			});

			const payload = JSON.stringify({
				blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'Test' } }],
			});
			const notification = new MockNotification(payload);

			const result = await slackChannel.send(notification);

			expect(result).toEqual({
				success: true,
				result: 'Slack notification sent successfully',
			});
			expect(mockFetch).toHaveBeenCalledWith(webhookUrl, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: payload,
			});
		});

		it('should wrap plain text content in Slack message format', async () => {
			mockFetch.mockResolvedValue({
				ok: true,
				text: jest.fn().mockResolvedValue('ok'),
			});

			const notification = new MockNotification('Plain text message');

			await slackChannel.send(notification);

			expect(mockFetch).toHaveBeenCalledWith(webhookUrl, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ text: 'Plain text message' }),
			});
		});

		it('should return failure when webhook returns non-ok response', async () => {
			mockFetch.mockResolvedValue({
				ok: false,
				status: 404,
				text: jest.fn().mockResolvedValue('channel_not_found'),
			});

			const notification = new MockNotification();

			const result = await slackChannel.send(notification);

			expect(result).toEqual({
				success: false,
				result: 'Slack webhook returned 404: channel_not_found',
			});
		});

		it('should return failure when webhook returns 403', async () => {
			mockFetch.mockResolvedValue({
				ok: false,
				status: 403,
				text: jest.fn().mockResolvedValue('invalid_token'),
			});

			const notification = new MockNotification();

			const result = await slackChannel.send(notification);

			expect(result).toEqual({
				success: false,
				result: 'Slack webhook returned 403: invalid_token',
			});
		});

		it('should handle network errors gracefully', async () => {
			mockFetch.mockRejectedValue(new Error('Network error'));

			const notification = new MockNotification();

			const result = await slackChannel.send(notification);

			expect(result).toEqual({
				success: false,
				result: 'Network error',
			});
		});

		it('should handle timeout errors', async () => {
			mockFetch.mockRejectedValue(new Error('The operation was aborted'));

			const notification = new MockNotification();

			const result = await slackChannel.send(notification);

			expect(result).toEqual({
				success: false,
				result: 'The operation was aborted',
			});
		});

		it('should handle unknown errors', async () => {
			mockFetch.mockRejectedValue('unexpected');

			const notification = new MockNotification();

			const result = await slackChannel.send(notification);

			expect(result).toEqual({
				success: false,
				result: 'Failed to send Slack notification',
			});
		});

		it('should send with Block Kit payload', async () => {
			mockFetch.mockResolvedValue({
				ok: true,
				text: jest.fn().mockResolvedValue('ok'),
			});

			const blocks = {
				blocks: [
					{
						type: 'header',
						text: { type: 'plain_text', text: '✅ Backup Complete: Test Plan' },
					},
					{
						type: 'section',
						fields: [
							{ type: 'mrkdwn', text: '*Plan:* Test Plan' },
							{ type: 'mrkdwn', text: '*Device:* Server-1' },
						],
					},
				],
			};
			const notification = new MockNotification(JSON.stringify(blocks));

			await slackChannel.send(notification);

			const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
			expect(callBody.blocks).toHaveLength(2);
			expect(callBody.blocks[0].type).toBe('header');
		});

		it('should pass options to send method', async () => {
			mockFetch.mockResolvedValue({
				ok: true,
				text: jest.fn().mockResolvedValue('ok'),
			});

			const notification = new MockNotification();
			const options = { channel: '#backups' };

			const result = await slackChannel.send(notification, options);

			expect(result.success).toBe(true);
		});
	});
});
