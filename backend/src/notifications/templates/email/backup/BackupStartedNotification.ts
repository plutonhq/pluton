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
		if (this.contentType === 'push') {
			return this.buildPushContent(data);
		}
		if (this.contentType === 'slack') {
			return this.buildSlackContent(data);
		}
		if (this.contentType === 'discord') {
			return this.buildDiscordContent(data);
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
			replicationStorages:
				plan.settings.replication?.enabled && plan.settings.replication?.storages
					? plan.settings.replication.storages.length
					: 0,
			eventName: 'backup_started',
		};
		return JSON.stringify(payload);
	}

	protected loadHTMLTemplate(): string {
		return loadBackupTemplate('BackupStartedNotification.ejs');
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

		const templateString = this.loadHTMLTemplate();
		const renderedBody = ejs.render(templateString, {
			...data,
			appUrl: configService.config.APP_URL,
			storageTypeName,
			startDate,
			formatBytes,
			formatNumberToK,
			replicationStorages:
				data.plan.settings.replication?.enabled && data.plan.settings.replication?.storages
					? data.plan.settings.replication.storages.length
					: 0,
		});

		return this.applyEmailTemplate(renderedBody, {
			appTitle: configService.config.APP_TITLE || 'Pluton',
			preHeader: `Backup Started: ${data.plan.title}`,
		});
	}

	protected buildSlackContent(data: BackupStartedPayload): string {
		const { appTitle, deviceName, storageName, storageType, plan, startTime } = data;
		const storageTypeName = storageType ? providers[storageType]?.name || storageType : '';
		const appUrl = configService.config.APP_URL || '';

		const fields: { type: string; text: string }[] = [
			{ type: 'mrkdwn', text: `*Plan:* ${plan.title}` },
			{ type: 'mrkdwn', text: `*Method:* ${plan.method}` },
			{ type: 'mrkdwn', text: `*Device:* ${deviceName}` },
			{ type: 'mrkdwn', text: `*Storage:* ${storageName} (${storageTypeName})` },
		];

		const blocks: Record<string, any>[] = [
			{
				type: 'header',
				text: { type: 'plain_text', text: `🚀 Backup Started: ${plan.title}`, emoji: true },
			},
			{
				type: 'section',
				fields,
			},
		];

		if (appUrl) {
			blocks.push({
				type: 'actions',
				elements: [
					{
						type: 'button',
						text: { type: 'plain_text', text: 'View Plan', emoji: true },
						url: `${appUrl}/plan/${plan.id}`,
					},
				],
			});
		}

		blocks.push({
			type: 'context',
			elements: [{ type: 'mrkdwn', text: `${appTitle} • ${new Date(startTime).toLocaleString()}` }],
		});

		return JSON.stringify({ blocks });
	}

	protected buildDiscordContent(data: BackupStartedPayload): string {
		const { appTitle, deviceName, storageName, storageType, plan, startTime } = data;
		const storageTypeName = storageType ? providers[storageType]?.name || storageType : '';
		const appUrl = configService.config.APP_URL || '';

		const fields: { name: string; value: string; inline: boolean }[] = [
			{ name: 'Plan', value: plan.title, inline: true },
			{ name: 'Method', value: plan.method, inline: true },
			{ name: 'Device', value: deviceName, inline: true },
			{ name: 'Storage', value: `${storageName} (${storageTypeName})`, inline: true },
		];

		const embed: Record<string, any> = {
			title: `🚀 Backup Started: ${plan.title}`,
			color: 0x3b82f6, // blue
			fields,
			timestamp: new Date(startTime).toISOString(),
			footer: { text: appTitle },
		};

		if (appUrl) {
			embed.url = `${appUrl}/plan/${plan.id}`;
		}

		return JSON.stringify({ embeds: [embed] });
	}

	buildPushContent(data: BackupStartedPayload) {
		const { appTitle, deviceName, storageName, storageType, plan } = data;
		const sourceCount = plan.sourceConfig.includes.length;
		const payload = {
			title: `${appTitle}: Backup Started for Plan "${plan.title}"`,
			body: `Backing up ${sourceCount} sources from ${deviceName} to ${storageName}(${storageType}).`,
			priority: 3,
			emoji: 'arrows_counterclockwise',
			buttonUrl: `${configService.config.APP_URL}/plan/${data.plan.id}`,
			buttonText: 'View Plan',
		};
		return JSON.stringify(payload);
	}
}
