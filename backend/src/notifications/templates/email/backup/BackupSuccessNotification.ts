import ejs from 'ejs';
import { configService } from '../../../../services/ConfigService';
import { Plan } from '../../../../db/schema/plans';
import { providers } from '../../../../utils/providers';
import {
	BackupCompletionStats,
	BackupNotificationJSONPayload,
	ReplicationFailureInfo,
} from '../../../../types/backups';
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
	replicationFailures?: ReplicationFailureInfo[];
	output?: 'html' | 'json' | 'push' | 'slack' | 'discord';
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

	protected buildJSONContent(data: BackupSuccessNotificationPayload): string {
		const {
			appTitle,
			deviceName,
			storageName,
			storageType,
			plan,
			stats,
			startTime,
			endTime,
			replicationFailures,
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
			eventName: 'backup_success',
			...(replicationFailures && replicationFailures.length > 0 ? { replicationFailures } : {}),
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
			replicationStorages:
				data.plan.settings.replication?.enabled && data.plan.settings.replication?.storages
					? data.plan.settings.replication.storages.length
					: 0,
			replicationFailures: data.replicationFailures || [],
		});

		return this.applyEmailTemplate(renderedBody, {
			appTitle: configService.config.APP_TITLE || 'Pluton',
			preHeader: `Backup Success: ${data.plan.title}`,
		});
	}

	protected buildSlackContent(data: BackupSuccessNotificationPayload): string {
		const {
			appTitle,
			deviceName,
			storageName,
			storageType,
			plan,
			stats,
			startTime,
			endTime,
			replicationFailures,
		} = data;
		const storageTypeName = storageType ? providers[storageType]?.name || storageType : '';
		const appUrl = configService.config.APP_URL || '';
		const hasReplicationFailures = replicationFailures && replicationFailures.length > 0;

		const fields: { type: string; text: string }[] = [
			{ type: 'mrkdwn', text: `*Plan:* ${plan.title}` },
			{ type: 'mrkdwn', text: `*Method:* ${plan.method}` },
			{ type: 'mrkdwn', text: `*Device:* ${deviceName}` },
			{ type: 'mrkdwn', text: `*Storage:* ${storageName} (${storageTypeName})` },
		];

		if (stats) {
			if (stats.total_files_processed)
				fields.push({
					type: 'mrkdwn',
					text: `*Files:* ${formatNumberToK(stats.total_files_processed)}`,
				});
			if (stats.total_bytes_processed)
				fields.push({
					type: 'mrkdwn',
					text: `*Size:* ${formatBytes(stats.total_bytes_processed)}`,
				});
			if (stats.total_duration)
				fields.push({
					type: 'mrkdwn',
					text: `*Duration:* ${formatDuration(stats.total_duration)}`,
				});
		}

		const blocks: Record<string, any>[] = [
			{
				type: 'header',
				text: {
					type: 'plain_text',
					text: `${hasReplicationFailures ? '⚠️' : '✅'} Backup Complete: ${plan.title}`,
					emoji: true,
				},
			},
			{
				type: 'section',
				fields,
			},
		];

		if (hasReplicationFailures) {
			blocks.push({
				type: 'section',
				text: {
					type: 'mrkdwn',
					text: `⚠️ *Replication Failures:* ${replicationFailures.map(f => f.storageName || f.storageId).join(', ')}`,
				},
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

	protected buildDiscordContent(data: BackupSuccessNotificationPayload): string {
		const {
			appTitle,
			deviceName,
			storageName,
			storageType,
			plan,
			stats,
			startTime,
			endTime,
			replicationFailures,
		} = data;
		const storageTypeName = storageType ? providers[storageType]?.name || storageType : '';
		const appUrl = configService.config.APP_URL || '';
		const hasReplicationFailures = replicationFailures && replicationFailures.length > 0;

		const fields: { name: string; value: string; inline: boolean }[] = [
			{ name: 'Plan', value: plan.title, inline: true },
			{ name: 'Method', value: plan.method, inline: true },
			{ name: 'Device', value: deviceName, inline: true },
			{ name: 'Storage', value: `${storageName} (${storageTypeName})`, inline: true },
		];

		if (stats) {
			if (stats.total_files_processed)
				fields.push({
					name: 'Files',
					value: formatNumberToK(stats.total_files_processed).toString(),
					inline: true,
				});
			if (stats.total_bytes_processed)
				fields.push({
					name: 'Size',
					value: formatBytes(stats.total_bytes_processed),
					inline: true,
				});
			if (stats.total_duration)
				fields.push({
					name: 'Duration',
					value: formatDuration(stats.total_duration),
					inline: true,
				});
		}

		if (replicationFailures && replicationFailures.length > 0) {
			fields.push({
				name: '⚠️ Replication Failures',
				value: replicationFailures.map(f => f.storageName || f.storageId).join(', '),
				inline: false,
			});
		}

		const embed: Record<string, any> = {
			title: `${hasReplicationFailures ? '⚠️' : '✅'} Backup Complete: ${plan.title}`,
			color: hasReplicationFailures ? 0xf59e0b : 0x22c55e,
			fields,
			timestamp: new Date(startTime).toISOString(),
			footer: { text: appTitle },
		};

		if (appUrl) {
			embed.url = `${appUrl}/plan/${plan.id}`;
		}

		return JSON.stringify({ embeds: [embed] });
	}

	buildPushContent(data: BackupSuccessNotificationPayload) {
		const { appTitle, deviceName, storageName, storageType, plan, stats, replicationFailures } =
			data;
		const hasReplicationFailures = replicationFailures && replicationFailures.length > 0;
		const sourceCount = plan.sourceConfig.includes.length;
		const backupChanges = () => {
			const newCount = (stats?.files_new || 0) + (stats?.dirs_new || 0);
			const modifiedCount = (stats?.files_changed || 0) + (stats?.dirs_changed || 0);
			const removedCount = 0;
			const parts = [];
			if (newCount > 0) parts.push(`${newCount} New`);
			if (modifiedCount > 0) parts.push(`${modifiedCount} Modified`);
			if (removedCount > 0) parts.push(`${removedCount} Removed`);
			return parts.length > 0 ? parts.join(' / ') : 'No Changes';
		};
		// const
		const payload = {
			title: `${appTitle}: Backup Successful for Plan "${plan.title}"`,
			body: `Successfully Backed up ${sourceCount} sources from ${deviceName} to ${storageName}(${storageType}). 
          
         Changes: ${backupChanges()} 
         Total Size: ${formatBytes(stats?.total_bytes_processed || 0)}
         Total Files: ${formatNumberToK(stats?.total_files_processed || 0)}
         Total Duration: ${formatDuration(stats?.total_duration || 0)}
         ${hasReplicationFailures ? `⚠️ Replication Failures: ${replicationFailures.map(f => f.storageName || f.storageId).join(', ')}` : ''}`,
			priority: 3,
			emoji: hasReplicationFailures ? 'warning' : 'white_check_mark',
			buttonUrl: `${configService.config.APP_URL}/plan/${data.plan.id}`,
			buttonText: 'View Plan',
		};
		return JSON.stringify(payload);
	}
}
