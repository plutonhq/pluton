import { BaseNotification } from '../BaseNotification';
import { NotificationChannel } from '../NotificationChannel';

export class DiscordChannel implements NotificationChannel {
	private webhookUrl: string;

	constructor(webhookUrl: string) {
		this.webhookUrl = webhookUrl;
	}

	async send(
		notification: BaseNotification,
		options?: Record<string, any>
	): Promise<{ success: boolean; result: string }> {
		try {
			const content = notification.getContent();
			let payload: Record<string, any>;

			try {
				payload = JSON.parse(content);
			} catch {
				// If content is plain text, wrap it in a Discord message format
				payload = { content };
			}

			const response = await fetch(this.webhookUrl, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			});

			if (!response.ok) {
				const errorText = await response.text();
				return {
					success: false,
					result: `Discord webhook returned ${response.status}: ${errorText}`,
				};
			}

			return {
				success: true,
				result: 'Discord notification sent successfully',
			};
		} catch (error: any) {
			return {
				success: false,
				result: error?.message || 'Failed to send Discord notification',
			};
		}
	}
}
