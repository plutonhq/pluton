import ejs from 'ejs';
import { configService } from '../../../../services/ConfigService';
import { Plan } from '../../../../db/schema/plans';
import { providers } from '../../../../utils/providers';
import { BackupNotificationJSONPayload, BackupTaskStats } from '../../../../types/backups';
import { formatBytes, formatDuration, formatNumberToK } from '../../../../utils/formatter';
import { BaseNotification } from '../../../BaseNotification';
import { loadBackupTemplate } from '../../../templateLoader';

export interface BackupFailedNotificationPayload {
	appTitle: string;
	deviceName: string;
	storageName: string;
	storageType: string;
	plan: Plan;
	startTime: Date;
	endTime: Date;
	error: string;
	stats?: BackupTaskStats;
	output?: 'html' | 'json' | 'push';
}

export class BackupFailedNotification extends BaseNotification {
	constructor(data: BackupFailedNotificationPayload) {
		super();
		this.subject = `Backup Failed: ${data.plan.title}`;
		this.contentType = data.output || 'html';
		this.content = this.buildContent(data);
	}

	protected buildContent(data: BackupFailedNotificationPayload): string {
		if (this.contentType === 'json') {
			return this.buildJSONContent(data);
		}
		return this.buildHTMLContent(data);
	}

	protected buildJSONContent(data: BackupFailedNotificationPayload): string {
		const {
			appTitle,
			deviceName,
			storageName,
			storageType,
			plan,
			stats,
			startTime,
			endTime,
			error,
		} = data;
		const payload: BackupNotificationJSONPayload = {
			appTitle,
			deviceName,
			storageName,
			storageType,
			storagePath: plan.storagePath || '',
			stats,
			startTime,
			endTime,
			error,
			planID: plan.id,
			planTitle: plan.title,
			planType: plan.method,
			planSource: {
				included: plan.sourceConfig?.includes.join(', ') || '',
				excluded: plan.sourceConfig?.excludes.join(', ') || '',
			},
			eventName: 'backup_failed',
		};
		return JSON.stringify(payload);
	}

	protected buildHTMLContent(data: BackupFailedNotificationPayload): string {
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

		const templateString = loadBackupTemplate('BackupFailedNotification.ejs');
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
			preHeader: `Backup Failed: ${data.plan.title}`,
			className: 'content--error',
		});
	}
}
