import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { isIP } from 'node:net';
/** Shared transport construction; TLS modes never downgrade or skip verification. */
export function secureSmtpOptions(input: {
	host: string;
	hostname?: string;
	port: number;
	security: 'plain' | 'starttls' | 'tls';
	username?: string;
	password?: string;
	timeoutMs: number;
}): SMTPTransport.Options {
	return {
		host: input.host,
		port: input.port,
		secure: input.security === 'tls',
		requireTLS: input.security === 'starttls',
		ignoreTLS: input.security === 'plain',
		auth: input.username ? { user: input.username, pass: input.password } : undefined,
		connectionTimeout: input.timeoutMs,
		greetingTimeout: input.timeoutMs,
		socketTimeout: input.timeoutMs,
		tls: {
			rejectUnauthorized: true,
			minVersion: 'TLSv1.2',
			servername: isIP(input.hostname || input.host) ? undefined : input.hostname || input.host,
		},
		logger: false,
		debug: false,
		disableFileAccess: true,
		disableUrlAccess: true,
	};
}
