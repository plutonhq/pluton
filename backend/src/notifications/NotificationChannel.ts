import { BaseNotification } from './BaseNotification';

export interface NotificationChannel {
	send(
		notification: BaseNotification,
		options?: Record<string, any>
	): Promise<{ success: boolean; result: string }>;
}
