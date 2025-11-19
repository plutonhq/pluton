export interface SmtpSettings {
	server: string;
	port: number;
	username: string;
	password: string;
	senderEmail: string;
	senderName?: string;
	connected: boolean;
}

export interface SendGridSettings {
	apiKey: string;
	senderEmail: string;
	senderName?: string;
	connected: boolean;
}

export interface MailgunSettings {
	apiKey: string;
	domain: string;
	senderEmail: string;
	senderName?: string;
	connected: boolean;
}

export interface BrevoSettings {
	apiKey: string;
	senderEmail: string;
	senderName?: string;
	connected: boolean;
}

export interface ResendSettings {
	apiKey: string;
	senderEmail: string;
	senderName?: string;
	connected: boolean;
}

export interface AwsSesSettings {
	accessKeyId: string;
	secretAccessKey: string;
	region: string;
	senderEmail: string;
	senderName?: string;
	connected: boolean;
}

export interface NTFYSettings {
	authType: string;
	authToken: string;
	connected: boolean;
}

export interface AppSettings {
	title: string;
	description: string;
	theme: 'light' | 'dark' | 'auto';
	admin_email: string;
	integration: {
		smtp?: SmtpSettings;
		sendgrid?: SendGridSettings;
		mailgun?: MailgunSettings;
		brevo?: BrevoSettings;
		awsSes?: AwsSesSettings;
		resend?: ResendSettings;
		ntfy?: NTFYSettings;
	};
	totp?: {
		enabled: boolean;
		secret: string;
		recoveryCodes: string[];
	};
	reporting: {
		emails: string[];
		time: string;
		sendWith?: IntegrationTypes;
		daily: {
			enabled: boolean;
		};
		weekly: {
			enabled: boolean;
		};
		monthly: {
			enabled: boolean;
		};
	};
}

export type IntegrationTypes = keyof AppSettings['integration'];
export const INTEGRATIONS_AVAILABLE: Record<
	IntegrationTypes,
	{ name: string; required: string[] }
> = {
	smtp: {
		name: 'SMTP',
		required: ['server', 'port', 'username', 'password', 'senderEmail'],
	},
	sendgrid: {
		name: 'SendGrid',
		required: ['apiKey', 'senderEmail'],
	},
	mailgun: {
		name: 'Mailgun',
		required: ['apiKey', 'domain', 'senderEmail'],
	},
	brevo: {
		name: 'Brevo',
		required: ['apiKey', 'senderEmail'],
	},
	resend: {
		name: 'Resend',
		required: ['apiKey', 'senderEmail'],
	},
	awsSes: {
		name: 'AWS SES',
		required: ['accessKeyId', 'secretAccessKey', 'region', 'senderEmail'],
	},
	ntfy: {
		name: 'Ntfy',
		required: ['authType', 'authToken'],
	},
} as const;
