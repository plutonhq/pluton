export interface SmtpSettingsType {
   server: string;
   port: number;
   username: string;
   password: string;
   connected: boolean;
   senderEmail: string;
}

export interface LogItem {
   level: number;
   time: number;
   pid: number;
   hostname: string;
   module: string;
   planId?: string;
   backupId?: string;
   deviceId?: string;
   msg: string;
}

export interface NtfySettingsType {
   authType: string;
   authToken: string;
   connected: boolean;
}

export interface IntegrationSettings {
   smtp?: SmtpSettingsType;
   ntfy?: NtfySettingsType;
}

export type IntegrationTypes = 'smtp' | 'sendgrid' | 'mailgun' | 'brevo' | 'resend' | 'awsSes' | 'ntfy';
export const INTEGRATIONS_AVAILABLE: Record<IntegrationTypes, { name: string; required: string[] }> = {
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
