import { NtfyChannel } from '../../src/notifications/channels/NtfyChannel';
import { BaseNotification } from '../../src/notifications/BaseNotification';
import { NTFYSettings } from '../../src/types/settings';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock notification for testing
class MockNotification extends BaseNotification {
	constructor(content: string = 'Test push notification', subject: string = 'Test Subject') {
		super();
		this.subject = subject;
		this.content = content;
	}

	protected buildContent(): string {
		return '';
	}
}

describe('NtfyChannel', () => {
	let ntfyChannel: NtfyChannel;
	const defaultSettings: NTFYSettings = {
		authType: 'token',
		authToken: 'tk_test123',
		connected: false,
	};

	beforeEach(() => {
		jest.clearAllMocks();
		ntfyChannel = new NtfyChannel(defaultSettings);
	});

	describe('constructor', () => {
		it('should create instance with ntfy settings', () => {
			expect(ntfyChannel).toBeInstanceOf(NtfyChannel);
			expect(ntfyChannel['ntfySettings']).toEqual(defaultSettings);
		});
	});

	describe('send', () => {
		it('should send notification successfully', async () => {
			mockFetch.mockResolvedValue({
				ok: true,
				text: jest.fn().mockResolvedValue('ok'),
			});

			const notification = new MockNotification('Hello from Pluton');
			const result = await ntfyChannel.send(notification, {
				url: 'https://ntfy.sh/testtopic',
			});

			expect(result).toEqual({
				success: true,
				result: 'Ntfy notification sent successfully',
			});
			expect(mockFetch).toHaveBeenCalledWith('https://ntfy.sh/testtopic', {
				method: 'POST',
				headers: {
					Title: 'Test Subject',
					Authorization: 'Bearer tk_test123',
				},
				body: 'Hello from Pluton',
			});
		});

		it('should include Authorization header when authToken is set', async () => {
			mockFetch.mockResolvedValue({ ok: true });

			const notification = new MockNotification();
			await ntfyChannel.send(notification, { url: 'https://ntfy.sh/topic' });

			const callArgs = mockFetch.mock.calls[0];
			expect(callArgs[1].headers.Authorization).toBe('Bearer tk_test123');
		});

		it('should not include Authorization header when authToken is empty', async () => {
			const noAuthSettings: NTFYSettings = {
				authType: 'token',
				authToken: '',
				connected: false,
			};
			ntfyChannel = new NtfyChannel(noAuthSettings);
			mockFetch.mockResolvedValue({ ok: true });

			const notification = new MockNotification();
			await ntfyChannel.send(notification, { url: 'https://ntfy.sh/topic' });

			const callArgs = mockFetch.mock.calls[0];
			expect(callArgs[1].headers.Authorization).toBeUndefined();
		});

		it('should return failure when topic URL is missing', async () => {
			const notification = new MockNotification();

			const result = await ntfyChannel.send(notification, {});

			expect(result).toEqual({
				success: false,
				result: 'Ntfy topic URL is required',
			});
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('should return failure when options is undefined', async () => {
			const notification = new MockNotification();

			const result = await ntfyChannel.send(notification);

			expect(result).toEqual({
				success: false,
				result: 'Ntfy topic URL is required',
			});
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('should return failure when ntfy returns non-ok response', async () => {
			mockFetch.mockResolvedValue({
				ok: false,
				status: 401,
				text: jest.fn().mockResolvedValue('unauthorized'),
			});

			const notification = new MockNotification();
			const result = await ntfyChannel.send(notification, {
				url: 'https://ntfy.sh/topic',
			});

			expect(result).toEqual({
				success: false,
				result: 'Ntfy returned 401: unauthorized',
			});
		});

		it('should return failure when ntfy returns 403', async () => {
			mockFetch.mockResolvedValue({
				ok: false,
				status: 403,
				text: jest.fn().mockResolvedValue('forbidden'),
			});

			const notification = new MockNotification();
			const result = await ntfyChannel.send(notification, {
				url: 'https://ntfy.sh/topic',
			});

			expect(result).toEqual({
				success: false,
				result: 'Ntfy returned 403: forbidden',
			});
		});

		it('should return failure when ntfy returns 404', async () => {
			mockFetch.mockResolvedValue({
				ok: false,
				status: 404,
				text: jest.fn().mockResolvedValue('not found'),
			});

			const notification = new MockNotification();
			const result = await ntfyChannel.send(notification, {
				url: 'https://ntfy.sh/topic',
			});

			expect(result).toEqual({
				success: false,
				result: 'Ntfy returned 404: not found',
			});
		});

		it('should handle network errors gracefully', async () => {
			mockFetch.mockRejectedValue(new Error('Network error'));

			const notification = new MockNotification();
			const result = await ntfyChannel.send(notification, {
				url: 'https://ntfy.sh/topic',
			});

			expect(result).toEqual({
				success: false,
				result: 'Network error',
			});
		});

		it('should handle unknown errors gracefully', async () => {
			mockFetch.mockRejectedValue('Unknown');

			const notification = new MockNotification();
			const result = await ntfyChannel.send(notification, {
				url: 'https://ntfy.sh/topic',
			});

			expect(result).toEqual({
				success: false,
				result: 'Failed to send Ntfy notification',
			});
		});

		it('should set the Title header from the notification subject', async () => {
			mockFetch.mockResolvedValue({ ok: true });

			const notification = new MockNotification('Body', 'My Custom Title');
			await ntfyChannel.send(notification, { url: 'https://ntfy.sh/topic' });

			const callArgs = mockFetch.mock.calls[0];
			expect(callArgs[1].headers.Title).toBe('My Custom Title');
		});

		it('should send the notification content as the body', async () => {
			mockFetch.mockResolvedValue({ ok: true });

			const notification = new MockNotification('Pluton backup completed.');
			await ntfyChannel.send(notification, { url: 'https://ntfy.sh/topic' });

			const callArgs = mockFetch.mock.calls[0];
			expect(callArgs[1].body).toBe('Pluton backup completed.');
		});
	});
});
