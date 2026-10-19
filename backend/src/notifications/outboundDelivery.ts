import http from 'node:http';
import https from 'node:https';
import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import nodemailer from 'nodemailer';
import { pinnedAddress, webhookUrl, DestinationError, type ResolveHost } from './deliveryPolicy';
import { notificationText } from './terminalPayload';
import { secureSmtpOptions } from './channels/secureSmtp';
import type { Channel, DeliveryResult, NotificationPayload } from '../types/notificationDelivery';

export function webhookSignature(
	secret: string,
	timestamp: string,
	eventId: string,
	body: string
): string {
	return (
		'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${eventId}.${body}`).digest('hex')
	);
}
export function httpOutcome(status: number, retryAfter?: string): DeliveryResult {
	if (status >= 200 && status < 300) return { success: true, status };
	if (status >= 300 && status < 400)
		return { success: false, retryable: false, code: 'redirect-refused', status };
	const retryable = [408, 429, 500, 502, 503, 504].includes(status);
	let retryAfterSeconds: number | undefined;
	if (retryAfter && retryable) {
		const seconds = /^\d+$/.test(retryAfter)
			? Number(retryAfter)
			: Math.ceil((Date.parse(retryAfter) - Date.now()) / 1000);
		if (Number.isFinite(seconds) && seconds >= 0) retryAfterSeconds = Math.min(3600, seconds);
	}
	return {
		success: false,
		retryable,
		code: retryable ? 'http-retryable' : 'http-rejected',
		status,
		retryAfterSeconds,
	};
}
export function deliveryFailure(error: unknown): DeliveryResult {
	if (error instanceof DestinationError)
		return { success: false, code: error.code, retryable: error.code !== 'unsafe-destination' };
	const code = (error as { code?: unknown })?.code;
	const status = (error as { responseCode?: unknown })?.responseCode;
	if (
		typeof code === 'string' &&
		(/TLS|CERT|SSL|SELF_SIGNED|UNABLE_TO_VERIFY|DEPTH_ZERO/.test(code) ||
			(code === 'ESOCKET' &&
				/certificate|self.signed|TLS|SSL/i.test(String((error as Error)?.message || ''))))
	)
		return { success: false, code: 'tls-failed', retryable: false };
	if (code === 'EAUTH') return { success: false, code: 'smtp-auth-failed', retryable: false };
	if (code === 'ETIMEDOUT' || code === 'ABORT_ERR' || (error as Error)?.name === 'TimeoutError')
		return { success: false, code: 'delivery-timeout', retryable: true };
	if (typeof status === 'number')
		return {
			success: false,
			code: status >= 400 && status < 500 ? 'smtp-retryable' : 'smtp-rejected',
			retryable: status >= 400 && status < 500,
		};
	if (
		typeof code === 'string' &&
		[
			'ECONNREFUSED',
			'ECONNRESET',
			'EPIPE',
			'ENETUNREACH',
			'EHOSTUNREACH',
			'ECONNECTION',
			'EDNS',
			'ESOCKET',
		].includes(code)
	)
		return { success: false, code: 'connection-failed', retryable: true };
	return { success: false, code: 'delivery-failed', retryable: false };
}
export async function deliverNotification(
	channel: Channel,
	payload: NotificationPayload,
	secret?: string,
	options: { resolver?: ResolveHost; canSend?: () => boolean } = {}
): Promise<DeliveryResult> {
	const signal = AbortSignal.timeout(channel.config.timeoutMs);
	try {
		if (channel.kind === 'webhook') {
			const url = webhookUrl(channel.config.url, channel.config);
			const host = url.hostname.replace(/^\[|\]$/g, '');
			const address = await pinnedAddress(host, channel.config, signal, options.resolver);
			if (signal.aborted) throw new DestinationError('delivery-timeout');
			if (options.canSend && !options.canSend()) return { success: false, code: 'channel-changed' };
			const body = JSON.stringify(payload);
			if (Buffer.byteLength(body) > 65536) return { success: false, code: 'delivery-failed' };
			const timestamp = String(Math.floor(Date.now() / 1000));
			const headers: Record<string, string | number> = {
				'Content-Type': 'application/json; charset=utf-8',
				'Content-Length': Buffer.byteLength(body),
				'User-Agent': 'Pluton-Notifications/1',
				'X-Pluton-Event-Id': payload.event_id,
				'X-Pluton-Timestamp': timestamp,
				'X-Pluton-Payload-Version': '1',
			};
			if (secret)
				headers['X-Pluton-Signature'] = webhookSignature(secret, timestamp, payload.event_id, body);
			return await new Promise<DeliveryResult>((resolve, reject) => {
				// Explicit approved IP avoids a second DNS lookup (also for literal hosts).
				const request = (url.protocol === 'https:' ? https : http).request(
					{
						protocol: url.protocol,
						hostname: address.address,
						port: url.port || (url.protocol === 'https:' ? 443 : 80),
						path: url.pathname,
						method: 'POST',
						headers: { ...headers, Host: url.host },
						agent: false,
						signal,
						maxHeaderSize: 16384,
						...(url.protocol === 'https:'
							? {
									servername: isIP(host) ? undefined : host,
									rejectUnauthorized: true,
									minVersion: 'TLSv1.2' as const,
								}
							: {}),
					},
					response => {
						const result = httpOutcome(response.statusCode || 0, response.headers['retry-after']);
						// Never retain/return provider bodies, URLs, error strings or redirect locations.
						response.destroy();
						resolve(result);
					}
				);
				request.once('error', reject);
				request.end(body);
			});
		}
		const config = channel.config;
		const address = await pinnedAddress(config.host, config, signal, options.resolver);
		if (signal.aborted) throw new DestinationError('delivery-timeout');
		if (options.canSend && !options.canSend()) return { success: false, code: 'channel-changed' };
		const transporter = nodemailer.createTransport(
			secureSmtpOptions({
				host: address.address,
				hostname: config.host,
				port: config.port,
				security: config.security,
				username: config.username,
				password: secret,
				timeoutMs: config.timeoutMs,
			})
		);
		let abort: (() => void) | undefined;
		try {
			const content = notificationText(payload);
			const message = {
				from: { name: config.senderName || 'Pluton', address: config.senderEmail },
				to: config.recipients,
				subject: content.subject,
				text: content.text,
				disableFileAccess: true,
				disableUrlAccess: true,
				headers: { 'X-Pluton-Event-Id': payload.event_id },
				messageId: `<${payload.event_id}.${channel.id}@pluton.invalid>`,
			};
			const accepted = await Promise.race([
				transporter.sendMail(message),
				new Promise<never>((_, reject) => {
					abort = () => {
						transporter.close();
						reject(new DestinationError('delivery-timeout'));
					};
					signal.addEventListener('abort', abort, { once: true });
				}),
			]);
			if (
				(Array.isArray(accepted.rejected) && accepted.rejected.length) ||
				!Array.isArray(accepted.accepted) ||
				accepted.accepted.length !== config.recipients.length
			)
				return { success: false, code: 'smtp-rejected', retryable: false };
			return { success: true }; // SMTP acceptance, not inbox delivery or application recovery.
		} finally {
			if (abort) signal.removeEventListener('abort', abort);
			transporter.close();
		}
	} catch (error) {
		return deliveryFailure(error);
	}
}
