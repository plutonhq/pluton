import { BackupTaskStats } from './backups';

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
