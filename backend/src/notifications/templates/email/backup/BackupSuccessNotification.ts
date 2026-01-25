import ejs from 'ejs';
import { configService } from '../../../../services/ConfigService';
import { Plan } from '../../../../db/schema/plans';
import { providers } from '../../../../utils/providers';
import { BackupCompletionStats, BackupNotificationJSONPayload } from '../../../../types/backups';
import { formatBytes, formatDuration, formatNumberToK } from '../../../../utils/formatter';
import { BaseNotification } from '../../../BaseNotification';
import { loadBackupTemplate } from '../../../templateLoader';

export interface BackupSuccessNotificationPayload {
	appTitle: string;
	deviceName: string;
	storageName: string;
	storageType: string;
	plan: Plan;
	startTime: Date;
	endTime: Date;
	stats?: BackupCompletionStats;
	output?: 'html' | 'json' | 'push';
}

export class BackupSuccessNotification extends BaseNotification {
	constructor(data: BackupSuccessNotificationPayload) {
		super();
		this.subject = `Backup Complete: ${data.plan.title}`;
		this.contentType = data.output || 'html';
		this.content = this.buildContent(data);
	}

	protected buildContent(data: BackupSuccessNotificationPayload): string {
		if (this.contentType === 'json') {
			return this.buildJSONContent(data);
		}
		return this.buildHTMLContent(data);
	}

	protected buildJSONContent(data: BackupSuccessNotificationPayload): string {
		const { appTitle, deviceName, storageName, storageType, plan, stats, startTime, endTime } =
			data;
		const payload: BackupNotificationJSONPayload = {
			appTitle,
			deviceName,
			storageName,
			storageType,
			storagePath: plan.storagePath || '',
			stats,
			startTime,
			endTime,
			planID: plan.id,
			planTitle: plan.title,
			planType: plan.method,
			planSource: {
				included: plan.sourceConfig?.includes.join(', ') || '',
				excluded: plan.sourceConfig?.excludes.join(', ') || '',
			},
			eventName: 'backup_success',
		};
		return JSON.stringify(payload);
	}

	protected buildHTMLContent(data: BackupSuccessNotificationPayload): string {
		// Generate the Email Body
		const startDate = new Date(data.startTime ? data.startTime : 0).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'long',
			day: 'numeric',
			hour: 'numeric',
			minute: 'numeric',
		});
		const endDate = new Date(data.endTime ? data.endTime : 0).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'long',
			day: 'numeric',
			hour: 'numeric',
			minute: 'numeric',
		});
		const storageTypeName = data.storageType
			? providers[data.storageType]?.name || data.storageType
			: '';
		const templateString = loadBackupTemplate('BackupSuccessNotification.ejs');
		const renderedBody = ejs.render(templateString, {
			...data,
			appUrl: configService.config.APP_URL,
			storageTypeName,
			startDate,
			endDate,
			formatBytes,
			formatDuration,
			formatNumberToK,
		});

		return this.applyEmailTemplate(renderedBody, {
			appTitle: configService.config.APP_TITLE || 'Pluton',
			preHeader: `Backup Success: ${data.plan.title}`,
		});
	}
}
