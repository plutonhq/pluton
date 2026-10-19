export const notificationEvents = [
	'backup.completed',
	'backup.completed_with_warning',
	'backup.failed',
	'backup.cancelled',
	'recovery.passed',
	'recovery.passed_with_warning',
	'recovery.failed',
	'recovery.cancelled',
] as const;
export type NotificationEventType = (typeof notificationEvents)[number];
export type NetworkPolicy = { network: 'public' | 'trusted-lan'; allowedCidrs: string[] };
export type WebhookConfig = NetworkPolicy & { url: string; timeoutMs: number };
export type SmtpConfig = NetworkPolicy & {
	host: string;
	port: number;
	security: 'plain' | 'starttls' | 'tls';
	username: string;
	senderEmail: string;
	senderName: string;
	recipients: string[];
	timeoutMs: number;
};
export type ChannelInput = {
	name: string;
	enabled: boolean;
	events: NotificationEventType[];
} & (
	| { kind: 'webhook'; config: WebhookConfig; secret?: string }
	| { kind: 'smtp'; config: SmtpConfig; secret?: string }
);
export type Channel = (
	| Omit<Extract<ChannelInput, { kind: 'webhook' }>, 'secret'>
	| Omit<Extract<ChannelInput, { kind: 'smtp' }>, 'secret'>
) & {
	id: string;
	revision: number;
	sourceFloor: number;
	deleted: boolean;
	secretConfigured: boolean;
};
export type Subscription = {
	enabled: boolean;
	channelIds: string[];
	events: NotificationEventType[];
};
export type NotificationPayload = {
	version: 1;
	event_id: string;
	event_type: NotificationEventType | 'notification.test';
	timestamp: string;
	plan?: { id: string; name: string };
	backup?: { id: string; status: string; snapshot_id: string | null };
	recovery?: { id: string; backup_id: string; status: string; snapshot_id: string };
	started_at?: string;
	completed_at?: string;
	duration_seconds?: number;
	error?: { category: string };
	warnings?: { category: string }[];
	summary?: {
		files?: number;
		bytes?: number;
		databases?: {
			database_id?: string;
			engine?: string;
			bytes: number;
			artifact_integrity: string;
			sql_import: string;
		}[];
		cleanup?: { workspace: boolean; databases: boolean };
	};
};
export const deliveryMessages = {
	'delivery-timeout': 'The delivery deadline expired.',
	'connection-failed': 'The destination could not be reached.',
	'dns-failed': 'Destination name resolution failed.',
	'unsafe-destination': 'The destination is outside its approved network policy.',
	'tls-failed': 'TLS certificate verification or negotiation failed.',
	'http-retryable': 'The receiver returned a retryable HTTP status.',
	'http-rejected': 'The receiver rejected the request.',
	'redirect-refused': 'HTTP redirects are not permitted.',
	'smtp-auth-failed': 'SMTP authentication failed.',
	'smtp-rejected': 'The SMTP relay rejected the message or a recipient.',
	'smtp-retryable': 'The SMTP relay returned a temporary failure.',
	'credential-invalid': 'The saved channel credential could not be decrypted.',
	'channel-disabled': 'The channel is disabled or deleted.',
	'channel-changed': 'The channel changed after this delivery was queued. Review before retrying.',
	'plan-removed': 'The associated plan no longer exists.',
	'subscription-disabled': 'This plan no longer subscribes to this channel and event.',
	'delivery-interrupted': 'The worker stopped before recording an outcome.',
	'delivery-failed': 'Notification delivery failed.',
} as const;
export type DeliveryCode = keyof typeof deliveryMessages;
export type DeliveryResult = {
	success: boolean;
	retryable?: boolean;
	code?: DeliveryCode;
	status?: number;
	retryAfterSeconds?: number;
};
export type Delivery = {
	id: string;
	eventId: string;
	eventType: string;
	planId: string | null;
	planName: string | null;
	channelId: string;
	channelName: string;
	kind: 'webhook' | 'smtp';
	revision: number;
	status: 'pending' | 'sending' | 'succeeded' | 'failed';
	attemptCount: number;
	cycleAttempts: number;
	manualRetries: number;
	createdAt: number;
	lastAttemptAt: number | null;
	nextAttemptAt: number | null;
	completedAt: number | null;
	leaseUntil: number | null;
	leaseOwner: string | null;
	errorCode: DeliveryCode | null;
	httpStatus: number | null;
	error?: string;
	canRetry?: boolean;
};
