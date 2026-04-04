import { DiscordChannel } from '../../src/notifications/channels/DiscordChannel';
import { BaseNotification } from '../../src/notifications/BaseNotification';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock notification for testing
class MockNotification extends BaseNotification {
	constructor(content: string = '{"content":"Test message"}', subject: string = 'Test Subject') {
		super();
		this.subject = subject;
		this.content = content;
	}

	protected buildContent(): string {
		return '';
	}
}

describe('DiscordChannel', () => {
	let discordChannel: DiscordChannel;
	const webhookUrl = 'https://discord.com/api/webhooks/1234567890/abcdefghijk';

	beforeEach(() => {
		jest.clearAllMocks();
		discordChannel = new DiscordChannel(webhookUrl);
	});

	describe('constructor', () => {
		it('should create instance with webhook URL', () => {
			expect(discordChannel).toBeInstanceOf(DiscordChannel);
			expect(discordChannel['webhookUrl']).toBe(webhookUrl);
		});
	});

	describe('send', () => {
		it('should send notification successfully with JSON content', async () => {
			mockFetch.mockResolvedValue({
				ok: true,
				text: jest.fn().mockResolvedValue(''),
			});

			const payload = JSON.stringify({
				embeds: [
					{
						title: '✅ Backup Complete',
						color: 0x22c55e,
						fields: [{ name: 'Plan', value: 'Test Plan', inline: true }],
					},
				],
			});
			const notification = new MockNotification(payload);

			const result = await discordChannel.send(notification);

			expect(result).toEqual({
				success: true,
				result: 'Discord notification sent successfully',
			});
			expect(mockFetch).toHaveBeenCalledWith(webhookUrl, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: payload,
			});
		});

		it('should wrap plain text content in Discord message format', async () => {
			mockFetch.mockResolvedValue({
				ok: true,
				text: jest.fn().mockResolvedValue(''),
			});

			const notification = new MockNotification('Plain text message');

			await discordChannel.send(notification);

			expect(mockFetch).toHaveBeenCalledWith(webhookUrl, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ content: 'Plain text message' }),
			});
		});

		it('should return failure when webhook returns non-ok response', async () => {
			mockFetch.mockResolvedValue({
				ok: false,
				status: 404,
				text: jest.fn().mockResolvedValue('Unknown Webhook'),
			});

			const notification = new MockNotification();

			const result = await discordChannel.send(notification);

			expect(result).toEqual({
				success: false,
				result: 'Discord webhook returned 404: Unknown Webhook',
			});
		});

		it('should return failure when webhook is rate limited', async () => {
			mockFetch.mockResolvedValue({
				ok: false,
				status: 429,
				text: jest.fn().mockResolvedValue('You are being rate limited.'),
			});

			const notification = new MockNotification();

			const result = await discordChannel.send(notification);

			expect(result).toEqual({
				success: false,
				result: 'Discord webhook returned 429: You are being rate limited.',
			});
		});

		it('should handle network errors gracefully', async () => {
			mockFetch.mockRejectedValue(new Error('Network error'));

			const notification = new MockNotification();

			const result = await discordChannel.send(notification);

			expect(result).toEqual({
				success: false,
				result: 'Network error',
			});
		});

		it('should handle unknown errors', async () => {
			mockFetch.mockRejectedValue('unexpected');

			const notification = new MockNotification();

			const result = await discordChannel.send(notification);

			expect(result).toEqual({
				success: false,
				result: 'Failed to send Discord notification',
			});
		});

		it('should send with embed payload', async () => {
			mockFetch.mockResolvedValue({
				ok: true,
				text: jest.fn().mockResolvedValue(''),
			});

			const embeds = {
				embeds: [
					{
						title: '❌ Backup Failed: Production Plan',
						color: 0xef4444,
						fields: [
							{ name: 'Plan', value: 'Production Plan', inline: true },
							{ name: 'Error', value: '```Connection timeout```', inline: false },
						],
						timestamp: '2024-01-15T10:00:00.000Z',
						footer: { text: 'Pluton' },
					},
				],
			};
			const notification = new MockNotification(JSON.stringify(embeds));

			await discordChannel.send(notification);

			const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
			expect(callBody.embeds).toHaveLength(1);
			expect(callBody.embeds[0].color).toBe(0xef4444);
			expect(callBody.embeds[0].fields).toHaveLength(2);
		});

		it('should pass options to send method', async () => {
			mockFetch.mockResolvedValue({
				ok: true,
				text: jest.fn().mockResolvedValue(''),
			});

			const notification = new MockNotification();
			const options = { username: 'Pluton Bot' };

			const result = await discordChannel.send(notification, options);

			expect(result.success).toBe(true);
		});
	});
});
