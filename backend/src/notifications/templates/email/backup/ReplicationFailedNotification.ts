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
	output?: 'html' | 'json' | 'push' | 'slack' | 'discord';
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
		if (this.contentType === 'slack') {
			return this.buildSlackContent(data);
		}
		if (this.contentType === 'discord') {
			return this.buildDiscordContent(data);
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

	protected loadHTMLTemplate(): string {
		return loadBackupTemplate('ReplicationFailedNotification.ejs');
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

		const templateString = this.loadHTMLTemplate();
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

	protected buildSlackContent(data: ReplicationFailedNotificationPayload): string {
		const {
			appTitle,
			deviceName,
			storageName,
			storageType,
			plan,
			error,
			failedMirrors,
			startTime,
		} = data;
		const storageTypeName = storageType ? providers[storageType]?.name || storageType : '';
		const appUrl = configService.config.APP_URL || '';

		const fields: { type: string; text: string }[] = [
			{ type: 'mrkdwn', text: `*Plan:* ${plan.title}` },
			{ type: 'mrkdwn', text: `*Device:* ${deviceName}` },
			{ type: 'mrkdwn', text: `*Storage:* ${storageName} (${storageTypeName})` },
		];

		const blocks: Record<string, any>[] = [
			{
				type: 'header',
				text: { type: 'plain_text', text: `⚠️ Replication Failed: ${plan.title}`, emoji: true },
			},
			{
				type: 'section',
				fields,
			},
			{
				type: 'section',
				text: { type: 'mrkdwn', text: `*Error:*\n\`\`\`${error}\`\`\`` },
			},
		];

		if (failedMirrors && failedMirrors.length > 0) {
			const mirrorText = failedMirrors
				.map(m => `• ${m.storageName}${m.error ? `: ${m.error}` : ''}`)
				.join('\n');
			blocks.push({
				type: 'section',
				text: { type: 'mrkdwn', text: `*Failed Mirrors:*\n${mirrorText}` },
			});
		}

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

	protected buildDiscordContent(data: ReplicationFailedNotificationPayload): string {
		const {
			appTitle,
			deviceName,
			storageName,
			storageType,
			plan,
			error,
			failedMirrors,
			startTime,
		} = data;
		const storageTypeName = storageType ? providers[storageType]?.name || storageType : '';
		const appUrl = configService.config.APP_URL || '';

		const fields: { name: string; value: string; inline: boolean }[] = [
			{ name: 'Plan', value: plan.title, inline: true },
			{ name: 'Device', value: deviceName, inline: true },
			{ name: 'Storage', value: `${storageName} (${storageTypeName})`, inline: true },
			{ name: 'Error', value: `\`\`\`${error}\`\`\``, inline: false },
		];

		if (failedMirrors && failedMirrors.length > 0) {
			fields.push({
				name: 'Failed Mirrors',
				value: failedMirrors
					.map(m => `• ${m.storageName}${m.error ? `: ${m.error}` : ''}`)
					.join('\n'),
				inline: false,
			});
		}

		const embed: Record<string, any> = {
			title: `⚠️ Replication Failed: ${plan.title}`,
			color: 0xf59e0b, // amber
			fields,
			timestamp: new Date(startTime).toISOString(),
			footer: { text: appTitle },
		};

		if (appUrl) {
			embed.url = `${appUrl}/plan/${plan.id}`;
		}

		return JSON.stringify({ embeds: [embed] });
	}

	buildPushContent(data: ReplicationFailedNotificationPayload) {
		const { appTitle, deviceName, storageName, storageType, plan, failedMirrors = [] } = data;
		const sourceCount = plan.sourceConfig.includes.length;

		const payload = {
			title: `${appTitle}: Replication Failed for Plan "${plan.title}"`,
			body: `Failed to replicate ${sourceCount} sources from ${deviceName} to ${failedMirrors.length} storages. 
         ${failedMirrors.map(mirror => `${mirror.storageName} : (${mirror.error || 'Unknown Error'})`).join(', ')}
         `,
			priority: 3,
			emoji: 'white_check_mark',
			buttonUrl: `${configService.config.APP_URL}/plan/${data.plan.id}`,
			buttonText: 'View Plan',
		};
		return JSON.stringify(payload);
	}
}
