import { BaseNotification } from './BaseNotification';
import { NotificationChannel } from './NotificationChannel';

export class NotificationManager {
	private channels: NotificationChannel[] = [];

	registerChannel(channel: NotificationChannel) {
		this.channels.push(channel);
	}

	async notify(notification: BaseNotification) {
		await Promise.all(this.channels.map(channel => channel.send(notification)));
	}
}
