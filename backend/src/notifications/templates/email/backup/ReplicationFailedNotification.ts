import ejs from 'ejs';
import { configService } from '../../../../services/ConfigService';
import { Plan } from '../../../../db/schema/plans';
import { providers } from '../../../../utils/providers';
import { formatBytes, formatDuration, formatNumberToK } from '../../../../utils/formatter';
import { BaseNotification } from '../../../BaseNotification';
import { loadBackupTemplate } from '../../../templateLoader';

export interface ReplicationFailedNotificationPayload {
	appTitle: string;
	deviceName: string;
	storageName: string;
	storageType: string;
	plan: Plan;
	startTime: Date;
	endTime: Date;
	error: string;
	failedMirrors?: { storageName: string; error?: string }[];
	output?: 'html' | 'json' | 'push';
}

export class ReplicationFailedNotification extends BaseNotification {
	constructor(data: ReplicationFailedNotificationPayload) {
		super();
		this.subject = `Replication Failed: ${data.plan.title}`;
		this.contentType = data.output || 'html';
		this.content = this.buildContent(data);
	}

	protected buildContent(data: ReplicationFailedNotificationPayload): string {
		if (this.contentType === 'json') {
			return this.buildJSONContent(data);
		}
		return this.buildHTMLContent(data);
	}

	protected buildJSONContent(data: ReplicationFailedNotificationPayload): string {
		const {
			appTitle,
			deviceName,
			storageName,
			storageType,
			plan,
			startTime,
			endTime,
			error,
			failedMirrors,
		} = data;
		const payload = {
			appTitle,
			deviceName,
			storageName,
			storageType,
			storagePath: plan.storagePath || '',
			startTime,
			endTime,
			error,
			failedMirrors,
			planID: plan.id,
			planTitle: plan.title,
			planType: plan.method,
			eventName: 'replication_failed',
		};
		return JSON.stringify(payload);
	}

	protected buildHTMLContent(data: ReplicationFailedNotificationPayload): string {
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

		const templateString = loadBackupTemplate('ReplicationFailedNotification.ejs');
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
			preHeader: `Replication Failed: ${data.plan.title}`,
			className: 'content--error',
		});
	}
}
