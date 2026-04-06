import { BaseNotification } from '../BaseNotification';
import { NotificationChannel } from '../NotificationChannel';
import { NTFYSettings } from '../../types/settings';

export class NtfyChannel implements NotificationChannel {
	protected ntfySettings: NTFYSettings;

	constructor(ntfySettings: NTFYSettings) {
		this.ntfySettings = ntfySettings;
	}

	async send(
		notification: BaseNotification,
		options?: Record<string, any>
	): Promise<{ success: boolean; result: string }> {
		try {
			const topicUrl = options?.url;
			if (!topicUrl) {
				return { success: false, result: 'Ntfy topic URL is required' };
			}

			const headers: Record<string, string> = {
				Title: options?.title || notification.getSubject(),
			};

			if (this.ntfySettings.authToken) {
				headers['Authorization'] = `Bearer ${this.ntfySettings.authToken}`;
			}

			if (options?.priority) headers['Priority'] = String(options.priority);
			if (options?.tags) headers['Tags'] = options.tags;
			if (options?.icon) headers['Icon'] = options.icon;
			if (options?.markdown) headers['Markdown'] = options.markdown;
			if (options?.actions) headers['Actions'] = options.actions;

			const body = options?.body ?? notification.getContent();

			const response = await fetch(topicUrl, {
				method: 'POST',
				headers,
				body,
			});

			if (!response.ok) {
				const errorText = await response.text();
				return {
					success: false,
					result: `Ntfy returned ${response.status}: ${errorText}`,
				};
			}

			return {
				success: true,
				result: 'Ntfy notification sent successfully',
			};
		} catch (error: any) {
			return {
				success: false,
				result: error?.message || 'Failed to send Ntfy notification',
			};
		}
	}
}
