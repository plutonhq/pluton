import ejs from 'ejs';
import { configService } from '../../../../services/ConfigService';
import { Plan } from '../../../../db/schema/plans';
import { providers } from '../../../../utils/providers';
import { BackupNotificationJSONPayload, BackupTaskStats } from '../../../../types/backups';
import { formatBytes, formatNumberToK } from '../../../../utils/formatter';
import { BaseNotification } from '../../../BaseNotification';
import { loadBackupTemplate } from '../../../templateLoader';

export interface BackupStartedPayload {
	appTitle: string;
	deviceName: string;
	storageName: string;
	storageType: string;
	plan: Plan;
	startTime: Date;
	stats?: BackupTaskStats;
	output?: string;
}

export class BackupStartedNotification extends BaseNotification {
	constructor(data: BackupStartedPayload) {
		super();
		this.subject = `Backup Started: ${data.plan.title}`;
		this.contentType = data.output || 'html';
		this.content = this.buildContent(data);
	}

	buildContent(data: BackupStartedPayload): string {
		if (this.contentType === 'json') {
			return this.buildJSONContent(data);
		}
		return this.buildHTMLContent(data);
	}

	protected buildJSONContent(data: BackupStartedPayload): string {
		const { appTitle, deviceName, storageName, storageType, plan, stats, startTime } = data;
		const payload: BackupNotificationJSONPayload = {
			appTitle,
			deviceName,
			storageName,
			storageType,
			storagePath: plan.storagePath || '',
			stats,
			startTime,
			planID: plan.id,
			planTitle: plan.title,
			planType: plan.method,
			planSource: {
				included: plan.sourceConfig?.includes.join(', ') || '',
				excluded: plan.sourceConfig?.excludes.join(', ') || '',
			},
			eventName: 'backup_started',
		};
		return JSON.stringify(payload);
	}

	protected buildHTMLContent(data: BackupStartedPayload): string {
		// Generate the Email Body
		const startDate = new Date(data.startTime ? data.startTime : 0).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'long',
			day: 'numeric',
			hour: 'numeric',
			minute: 'numeric',
		});

		const storageTypeName = data.storageType
			? providers[data.storageType]?.name || data.storageType
			: '';

		const templateString = loadBackupTemplate('BackupStartedNotification.ejs');
		const renderedBody = ejs.render(templateString, {
			...data,
			appUrl: configService.config.APP_URL,
			storageTypeName,
			startDate,
			formatBytes,
			formatNumberToK,
		});

		return this.applyEmailTemplate(renderedBody, {
			appTitle: configService.config.APP_TITLE || 'Pluton',
			preHeader: `Backup Started: ${data.plan.title}`,
		});
	}
}
