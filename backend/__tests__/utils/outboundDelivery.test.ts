import { EventEmitter } from 'node:events';
import http from 'node:http';
import https from 'node:https';
import nodemailer from 'nodemailer';
import { createHmac } from 'node:crypto';
import {
	deliverNotification,
	deliveryFailure,
	httpOutcome,
	webhookSignature,
} from '../../src/notifications/outboundDelivery';
import { notificationText } from '../../src/notifications/terminalPayload';
import { notificationFixture, fixtureSecret } from '../fixtures/notifications';
jest.mock('node:http', () => ({ ...jest.requireActual('node:http'), request: jest.fn() }));
jest.mock('node:https', () => ({ ...jest.requireActual('node:https'), request: jest.fn() }));
jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));
describe('safe outbound delivery', () => {
	let fixture: ReturnType<typeof notificationFixture>;
	const payload = {
		version: 1 as const,
		event_id: 'event-01',
		event_type: 'notification.test' as const,
		timestamp: '2026-10-13T00:00:00.000Z',
	};
	beforeEach(() => {
		fixture = notificationFixture();
		jest.clearAllMocks();
	});
	afterEach(() => fixture.sqlite.close());
	it('posts a bounded JSON body to a pinned address, preserving Host/SNI, and signs timestamp, event ID and exact bytes', async () => {
		const callback = jest.fn();
		const request = Object.assign(new EventEmitter(), { end: callback });
		let headers: any;
		jest.mocked(https.request).mockImplementation(((options: any, done: any) => {
			headers = options;
			queueMicrotask(() => done({ statusCode: 204, headers: {}, destroy: jest.fn() }));
			return request;
		}) as any);
		const resolver = jest.fn().mockResolvedValue([{ address: '203.0.113.20', family: 4 }]);
		const channel = fixture.store.saveChannel(fixture.channel());
		expect(await deliverNotification(channel, payload, fixtureSecret, { resolver })).toEqual({
			success: true,
			status: 204,
		});
		expect(resolver).toHaveBeenCalledTimes(1);
		expect(headers).toMatchObject({
			hostname: '203.0.113.20',
			servername: 'notify.example.internal',
			rejectUnauthorized: true,
			agent: false,
			method: 'POST',
			path: '/events',
		});
		const body = callback.mock.calls[0][0];
		expect(JSON.parse(body)).toEqual(payload);
		const signed = `${headers.headers['X-Pluton-Timestamp']}.${payload.event_id}.${body}`;
		expect(headers.headers['X-Pluton-Signature']).toBe(
			'sha256=' + createHmac('sha256', fixtureSecret).update(signed).digest('hex')
		);
		expect(body).not.toContain(fixtureSecret);
	});
	it.each([200, 201, 204, 299])('accepts HTTP %d', status =>
		expect(httpOutcome(status)).toMatchObject({ success: true, status })
	);
	it.each([408, 429, 500, 502, 503, 504])('retries HTTP %d within a bounded policy', status =>
		expect(httpOutcome(status, '999999')).toMatchObject({
			success: false,
			retryable: true,
			retryAfterSeconds: 3600,
		})
	);
	it.each([400, 401, 403, 404, 422, 501, 505])('permanently rejects HTTP %d', status =>
		expect(httpOutcome(status)).toMatchObject({ success: false, retryable: false })
	);
	it.each([301, 302, 307, 308])('refuses redirect %d without following its URL', status =>
		expect(httpOutcome(status)).toMatchObject({ code: 'redirect-refused', retryable: false })
	);
	it('rechecks rebinding policy and channel approval before connecting, without exposing provider secrets', async () => {
		const channel = fixture.store.saveChannel(fixture.channel());
		const resolver = jest.fn().mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
		expect(await deliverNotification(channel, payload, fixtureSecret, { resolver })).toMatchObject({
			code: 'unsafe-destination',
		});
		expect(https.request).not.toHaveBeenCalled();
		resolver.mockResolvedValue([{ address: '203.0.113.20', family: 4 }]);
		expect(
			await deliverNotification(channel, payload, fixtureSecret, { resolver, canSend: () => false })
		).toMatchObject({ code: 'channel-changed' });
		expect(http.request).not.toHaveBeenCalled();
		expect(https.request).not.toHaveBeenCalled();
		expect(JSON.stringify(deliveryFailure(new Error(fixtureSecret)))).not.toContain(fixtureSecret);
	});
	it.each([
		['plain', false, false, true],
		['starttls', false, true, false],
		['tls', true, false, false],
	] as const)(
		'SMTP %s uses the correct non-downgrading transport',
		(security, secure, requireTLS, ignoreTLS) => {
			// Configuration-only assertion complements real disposable SMTP integration.
			const { secureSmtpOptions } = jest.requireActual(
				'../../src/notifications/channels/secureSmtp'
			);
			const options = secureSmtpOptions({
				host: '192.168.50.20',
				hostname: 'smtp.example.internal',
				port: 25,
				security,
				timeoutMs: 1000,
			});
			expect(options).toMatchObject({
				secure,
				requireTLS,
				ignoreTLS,
				tls: {
					rejectUnauthorized: true,
					minVersion: 'TLSv1.2',
					servername: 'smtp.example.internal',
				},
			});
			expect(options.auth).toBeUndefined();
		}
	);
	it.each([true, false])(
		'supports SMTP authentication enabled = %s with write-only password',
		async auth => {
			const sendMail = jest
				.fn()
				.mockResolvedValue({ accepted: ['operator@example.invalid'], rejected: [] });
			const close = jest.fn();
			jest.mocked(nodemailer.createTransport).mockReturnValue({ sendMail, close } as any);
			const config = fixture.channel('smtp') as any;
			if (!auth) {
				config.config.username = '';
				delete config.secret;
			}
			const channel = fixture.store.saveChannel(config);
			expect(
				await deliverNotification(channel, payload, auth ? fixtureSecret : undefined, {
					resolver: async () => [{ address: '203.0.113.20', family: 4 }],
				})
			).toEqual({ success: true });
			const options = jest.mocked(nodemailer.createTransport).mock.calls[0][0] as any;
			expect(options.auth).toEqual(
				auth ? { user: 'notification-user', pass: fixtureSecret } : undefined
			);
			expect(close).toHaveBeenCalled();
			expect(JSON.stringify(sendMail.mock.calls[0][0])).not.toContain(fixtureSecret);
		}
	);
	it('SMTP rejection / timeout / connection failure classify safely and partial recipient acceptance is not success', async () => {
		const sendMail = jest.fn().mockResolvedValue({
			accepted: ['operator@example.invalid'],
			rejected: ['rejected@example.invalid'],
		});
		jest.mocked(nodemailer.createTransport).mockReturnValue({ sendMail, close: jest.fn() } as any);
		const channel = fixture.store.saveChannel(fixture.channel('smtp'));
		expect(
			await deliverNotification(channel, payload, fixtureSecret, {
				resolver: async () => [{ address: '203.0.113.20', family: 4 }],
			})
		).toMatchObject({ success: false, code: 'smtp-rejected' });
		for (const [error, code, retryable] of [
			[{ code: 'EAUTH', message: fixtureSecret }, 'smtp-auth-failed', false],
			[{ code: 'ETIMEDOUT', message: fixtureSecret }, 'delivery-timeout', true],
			[{ code: 'ECONNREFUSED', message: fixtureSecret }, 'connection-failed', true],
			[{ responseCode: 450, message: fixtureSecret }, 'smtp-retryable', true],
			[{ responseCode: 550, message: fixtureSecret }, 'smtp-rejected', false],
			[{ code: 'DEPTH_ZERO_SELF_SIGNED_CERT', message: fixtureSecret }, 'tls-failed', false],
		] as const)
			expect(deliveryFailure(error)).toMatchObject({ code, retryable });
	});
	it('signature changes on metadata/body changes, and recovery email never overclaims an untested SQL import', () => {
		expect(webhookSignature('fixture', '123', 'event-01', '{}')).not.toBe(
			webhookSignature('fixture', '123', 'event-02', '{}')
		);
		expect(webhookSignature('fixture', '123', 'event-01', '{}')).not.toBe(
			webhookSignature('fixture', '124', 'event-01', '{}')
		);
		const text = notificationText({
			...payload,
			event_type: 'recovery.passed_with_warning',
			plan: { id: 'plan-01', name: 'Example' },
			recovery: {
				id: 'recovery-01',
				backup_id: 'backup-01',
				status: 'passed_with_warning',
				snapshot_id: 'a'.repeat(64),
			},
			summary: {
				databases: [
					{ engine: 'mariadb', bytes: 500, artifact_integrity: 'passed', sql_import: 'not_tested' },
				],
			},
		});
		expect(text.subject).toContain('Passed with Warning');
		expect(text.text).toContain('SQL import NOT TESTED');
		expect(text.text).toContain('not a guarantee of semantic application recovery');
	});
});
