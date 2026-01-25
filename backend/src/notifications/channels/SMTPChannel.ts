import nodemailer from 'nodemailer';
import { BaseNotification } from '../BaseNotification';
import { NotificationChannel } from '../NotificationChannel';
import { SmtpSettings } from '../../types/settings';

export class SMTPChannel implements NotificationChannel {
	private transporter!: nodemailer.Transporter;
	protected smtpSettings: SmtpSettings;

	constructor(smtpSettings: SmtpSettings) {
		this.smtpSettings = smtpSettings;
	}

	async initialize() {
		const smtpConfig = this.smtpSettings;
		const senderName = smtpConfig?.senderName || 'Pluton Backup';

		// console.log('smtpConfig :', smtpConfig);/
		this.transporter = nodemailer.createTransport({
			host: smtpConfig.server,
			port: smtpConfig.port,
			secure: smtpConfig.port === 465,
			requireTLS: false,
			// debug: true,
			// logger: true,
			greetingTimeout: 10000,
			auth: {
				user: smtpConfig.username,
				pass: smtpConfig.password,
			},
			tls: {
				// Disable certificate verification
				rejectUnauthorized: false,
			},
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
			console.error('Email Send Error:', error);
			return {
				success: false,
				result: error?.message || 'Failed to send email',
			};
		}
	}
}
