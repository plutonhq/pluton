import nodemailer from 'nodemailer';
import { BaseNotification } from '../BaseNotification';
import { NotificationChannel } from '../NotificationChannel';
import { SmtpSettings } from '../../types/settings';
import { secureSmtpOptions } from './secureSmtp';
import { z } from 'zod';

export class SMTPChannel implements NotificationChannel {
	private transporter!: nodemailer.Transporter;
	protected smtpSettings: SmtpSettings;

	constructor(smtpSettings: SmtpSettings) {
		this.smtpSettings = smtpSettings;
	}

	async initialize() {
		const smtpConfig = this.smtpSettings;
		const senderName = smtpConfig?.senderName || 'Pluton Backup';

		const security = smtpConfig.security || (smtpConfig.port === 465 ? 'tls' : 'starttls');
		if (
			(security === 'plain' && !smtpConfig.trustedPlain) ||
			Array.from(senderName).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
			!z.email().safeParse(smtpConfig.senderEmail).success
		)
			throw new Error('Invalid SMTP configuration.');
		this.transporter = nodemailer.createTransport({
			...secureSmtpOptions({
				host: smtpConfig.server,
				port: smtpConfig.port,
				security,
				username: smtpConfig.username,
				password: smtpConfig.password,
				timeoutMs: 15000,
			}),
			from: `${senderName} <${smtpConfig.senderEmail}>`,
		});
	}

	async send(
		notification: BaseNotification,
		options: Record<string, any>
	): Promise<{ success: boolean; result: string }> {
		try {
			if (!this.transporter) {
				await this.initialize();
			}

			const mailOptions = {
				from: this.transporter.options.from,
				to: options?.emails ? options.emails : this.transporter.options.to,
				subject: notification.getSubject(),
				html: notification.getContent(),
			};

			const result = await this.transporter.sendMail(mailOptions);
			// console.log('Email Send Result :', result);

			return {
				success: true,
				result: `Email sent successfully to ${mailOptions.to}`,
			};
		} catch (error: any) {
			return {
				success: false,
				result: 'SMTP delivery failed. Check authentication, TLS and relay configuration.',
			};
		}
	}
}
