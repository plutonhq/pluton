import { BackupTaskStats } from './backups';
import { NotificationChannel } from '../notifications/NotificationChannel';
import { AppSettings, IntegrationTypes } from './settings';

/**
 * Interface for NotificationChannelResolver to allow extension in pro
 */
export interface INotificationChannelResolver {
	secretFields: string[];
	getChannel(channelType?: IntegrationTypes): Promise<NotificationChannel>;
	encryptSecrets(integration: AppSettings['integration']): AppSettings['integration'];
	decryptSecrets(integration: AppSettings['integration']): AppSettings['integration'];
}

export interface BackupNotificationData {
	planId: string;
	planName: string;
	sourceId: string;
	sourceType: string;
	storageId: string;
	storagePath?: string | null;
	deviceName?: string;
	startTime: Date;
	sourceConfig?: {
		includes: string[];
		excludes: string[];
	};
	encryption: boolean;
	compression: boolean;
	taskStats?: BackupTaskStats;
}
