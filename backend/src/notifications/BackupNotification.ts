import { BackupCompletionStats, BackupTaskStats } from '../types/backups';
import { PlanFull } from '../types/plans';
import { INotificationChannelResolver } from '../types/notifications';
import { BackupStartedNotification } from './templates/email/backup/BackupStartedNotification';
import { BackupSuccessNotification } from './templates/email/backup/BackupSuccessNotification';
import { BackupFailedNotification } from './templates/email/backup/BackupFailedNotification';
import { planLogger } from '../utils/logger';
import { NotificationChannelResolver } from '../notifications/channels/NotificationChannelResolver';
import { configService } from '../services/ConfigService';

interface BackupDataType {
	id?: string;
	startTime?: Date;
	endTime?: Date;
	error?: string;
	stats?: BackupTaskStats | BackupCompletionStats;
}

type NotificationType = 'start' | 'end' | 'success' | 'failure';

export class BackupNotification {
	protected BackupStartedNotificationClass = BackupStartedNotification;
	protected BackupSuccessNotificationClass = BackupSuccessNotification;
	protected BackupFailedNotificationClass = BackupFailedNotification;
	protected notificationChannelResolver: INotificationChannelResolver = NotificationChannelResolver;

	shouldSend(notificationCase: string, notificationType: string) {
		return (
			notificationCase === 'both' ||
			notificationCase === notificationType ||
			(notificationCase === 'end' && ['success', 'failure'].includes(notificationType))
		);
	}

	async send(plan: PlanFull, notificationType: NotificationType, backupData?: BackupDataType) {
		const notification = plan.settings.notification;

		if (notification?.email?.enabled) {
			await this.sendEmail(plan, notificationType, backupData);
		}
	}

	async sendEmail(
		plan: PlanFull,
		notificationType: NotificationType,
		backupData?: BackupDataType,
		notificationCase?: string
	) {
		try {
			const notification = plan.settings.notification;
			const shouldSend = this.shouldSend(notification?.email?.case || 'end', notificationType);
			if (!shouldSend) throw new Error('Does not match Plan Notification Case.');
			const emailType = notification?.email?.type || 'smtp';

			if (!notification?.email?.emails) throw new Error('Email Notification Emails Missing.');
			const emailChannel = await this.notificationChannelResolver.getChannel(emailType);
			const notificationClass = await this.getNotificationClass(
				plan,
				notificationType,
				backupData,
				'html'
			);
			const notificationResult = await emailChannel.send(notificationClass, {
				emails: notification.email.emails,
			});

			if (!notificationResult?.success)
				throw new Error(notificationResult?.result || 'Unknown Error');

			// Log Success Notification Result
			planLogger('notification', plan.id, backupData?.id).info(
				`Backup ${notificationType} Notification Email Sent Successfully.`
			);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown Error.';
			planLogger('notification', plan.id, backupData?.id).error(
				`Error Sending Backup ${notificationType} Email Notification. Reason: ${errorMessage}`
			);
		}
	}

	async getNotificationClass(
		plan: PlanFull,
		notificationType: NotificationType,
		backupData?: BackupDataType,
		output: 'html' | 'json' | 'push' = 'html'
	) {
		let notificationClass;
		const deviceName = plan.device?.name || '';
		const storageName = plan.storage?.name || '';
		const storageType = plan.storage?.type || '';
		switch (notificationType) {
			case 'start':
				notificationClass = new this.BackupStartedNotificationClass({
					appTitle: configService.config.APP_TITLE || 'Pluton',
					plan,
					deviceName,
					storageName,
					storageType,
					startTime: backupData?.startTime || new Date(),
					stats: backupData?.stats as BackupTaskStats,
					output,
				});
				break;
			case 'success':
				notificationClass = new this.BackupSuccessNotificationClass({
					appTitle: configService.config.APP_TITLE || 'Pluton',
					plan,
					deviceName,
					storageName,
					storageType,
					startTime: backupData?.startTime || new Date(),
					endTime: backupData?.endTime || new Date(),
					stats: backupData?.stats as BackupCompletionStats,
					output,
				});
				break;
			case 'failure':
				notificationClass = new this.BackupFailedNotificationClass({
					appTitle: configService.config.APP_TITLE || 'Pluton',
					plan,
					deviceName,
					storageName,
					storageType,
					error: backupData?.error || '',
					startTime: backupData?.startTime || new Date(),
					endTime: backupData?.endTime || new Date(),
					stats: backupData?.stats as BackupTaskStats,
					output,
				});
				break;
			case 'end':
				if (backupData?.error) {
					notificationClass = new BackupFailedNotification({
						appTitle: configService.config.APP_TITLE || 'Pluton',
						plan,
						deviceName,
						storageName,
						storageType,
						error: backupData?.error || '',
						startTime: backupData?.startTime || new Date(),
						endTime: backupData?.endTime || new Date(),
						stats: backupData?.stats as BackupTaskStats,
						output,
					});
				} else {
					notificationClass = new BackupSuccessNotification({
						appTitle: configService.config.APP_TITLE || 'Pluton',
						plan,
						deviceName,
						storageName,
						storageType,
						startTime: backupData?.startTime || new Date(),
						endTime: backupData?.endTime || new Date(),
						stats: backupData?.stats as BackupCompletionStats,
						output,
					});
				}

				break;
			// Add other notification types here
		}

		return notificationClass;
	}
}
