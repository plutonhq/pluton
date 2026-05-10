import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { sql } from 'drizzle-orm';
import { BaseBackupManager } from '../../managers/BaseBackupManager';
import { BackupStore } from '../../stores/BackupStore';
import { PlanStore } from '../../stores/PlanStore';
import { planLogger } from '../../utils/logger';
import { BackupNotification } from '../../notifications/BackupNotification';
import { appPaths } from '../../utils/AppPaths';
import { Backup, backupInsertSchema, NewBackup } from '../../db/schema/backups';
import { SourceTypes } from '../../types/source';
// import { jobProcessor } from '../../jobs/JobProcessor';
import {
	BackupInitEvent,
	BackupStartEvent,
	BackupCompleteEvent,
	BackupErrorEvent,
	PruneEndEvent,
	// BackupProgressEvent,
	BackupStatUpdateEvent,
} from '../../types/events';
import { generateResticRepoPath } from '../../utils/restic/helpers';
import { BackupVerifiedResult, PlanReplicationStorage, PlanStorageItem } from '../../types/plans';
import { handleResticCheckResult } from '../../utils/restic/restic';

export class BackupEventService {
	protected backupNotification: BackupNotification;
	protected progressDir = appPaths.getProgressDir();

	constructor(
		protected planStore: PlanStore,
		protected backupStore: BackupStore,
		protected localAgent?: BaseBackupManager
	) {
		this.backupNotification = new BackupNotification();
	}

	async onBackupInit(data: BackupInitEvent): Promise<void> {
		const { planId, backupId } = data;
		if (!planId) {
			return;
		}

		const existingBackup = await this.backupStore.getById(backupId);
		if (existingBackup && existingBackup.sourceId === 'main' && this.localAgent) {
			// This is a RETRY. Re-initialize the state for the new attempt.
			await this.backupStore.update(backupId, {
				inProgress: true,
				status: 'retrying',
				ended: null,
			});

			this.localAgent.emit('backup_created', { planId, backupId });
			return;
		}

		const activeBackups = await this.planStore.hasActiveBackups(planId);
		if (activeBackups) {
			planLogger('backup', planId).error(
				`Failed to Start Backup as a backup is already running for this plan.`
			);
			// TODO: Emit Backup Failure Event which should notify the user through email.
		} else {
			const thePlan = await this.planStore.getById(planId);
			if (!thePlan) {
				return;
			}

			try {
				const {
					storageId,
					sourceId,
					sourceType,
					storagePath,
					sourceConfig,
					settings: { encryption, compression },
				} = thePlan;
				const newBackupData: NewBackup = {
					id: backupId,
					status: 'initializing',
					inProgress: true,
					planId,
					storageId,
					sourceId,
					sourceType,
					storagePath,
					encryption,
					compression,
					sourceConfig,
					taskStats: null,
					method: thePlan.method,
				};

				// Parse Backup Data
				let parsedBackupData = { ...newBackupData };
				try {
					const parsedBackupDataRaw = backupInsertSchema.parse(newBackupData);
					parsedBackupData = {
						...parsedBackupDataRaw,
						sourceType: parsedBackupDataRaw.sourceType as SourceTypes,
					};
				} catch (error: any) {
					console.error('Error parsing settings data:', error);
					planLogger('backup', planId).error(
						`Error parsing Backup Data provided by the source. ${error?.message || 'Unknown Error'}`
					);
					return;
				}

				// Create Backup entry in Database
				const backup = await this.backupStore.create(parsedBackupData);
				if (!backup) {
					planLogger('backup', planId).error('Failed to Create Backup entry in Database.');
					return;
				}

				// If it's local agent, emit the event and initialize the progress file
				if (sourceId === 'main' && this.localAgent) {
					this.localAgent.emit('backup_created', {
						planId: planId,
						backupId: backup.id,
					});
				}

				// Log Backup Init Event
				planLogger('backup', planId, backup.id).info(
					`Initializing Backup for "${thePlan?.title || 'Unknown Plan'}"`
				);
			} catch (error: any) {
				planLogger('backup', planId).error(
					`Error Initializing Backup for Plan ${planId} : ${
						error?.message.toString() || 'Unknown Error'
					}`
				);
			}
		}
	}

	async onBackupStart(data: BackupStartEvent): Promise<void> {
		const { planId, backupId, summary } = data;
		if (!planId) {
			return;
		}

		try {
			// Update the existing backup entry with dry run summary and status
			const backup = await this.backupStore.update(backupId, {
				status: 'started',
				taskStats: summary,
			});
			if (!backup) {
				planLogger('backup', planId).error('Failed to update Backup entry with dry run summary.');
				return;
			}

			// Send Notification
			const plan = await this.planStore.getById(planId);
			if (plan && plan.settings.notification) {
				await this.backupNotification.send(plan, 'start', {
					id: backup.id,
					startTime: backup.started || new Date(),
					stats: summary,
				});
			}
			// Log Backup Start Event
			planLogger('backup', planId, backup.id).info(
				`Started Backing Up "${plan?.title || 'Unknown Plan'}"`
			);
		} catch (error: any) {
			planLogger('backup', planId).error(
				`Error Starting Backup for Plan ${planId} : ${error?.message.toString() || 'Unknown Error'}`
			);
		}
	}

	async onBackupComplete(data: BackupCompleteEvent): Promise<void> {
		const { planId, success, backupId, summary } = data;
		const progressFile = `${this.progressDir}/backup-${backupId}.json`;
		let summaryData: any = null;
		let totalDuration = 0;
		try {
			// If remote agent summary data is already provided, use it
			if (summary && summary.message_type === 'summary') {
				summaryData = summary;
				totalDuration = summary.total_duration || 0;
			} else {
				// If local agent, read the progress file to get the summary data
				try {
					if (existsSync(progressFile)) {
						const backupProgressData = JSON.parse(await readFile(progressFile, 'utf8'));
						if (backupProgressData.events && backupProgressData.events.length > 0) {
							const eventsWithSummary = backupProgressData.events.filter(
								(event: any) => event.resticData && event.resticData.message_type === 'summary'
							);
							if (eventsWithSummary.length > 0) {
								const lastEvent = eventsWithSummary[eventsWithSummary.length - 1];
								summaryData = lastEvent.resticData;
								totalDuration = lastEvent.resticData.total_duration || 0;
							}
						}
					}
				} catch (error: any) {
					planLogger('backup', planId, backupId).warn(
						`Could not read progress file to fetch the completion summary: ${error.message}`
					);
				}
			}

			const backupPayload: Partial<Backup> = {
				inProgress: false,
				status: success ? 'completed' : 'failed',
				success: !!success,
				ended: sql`(unixepoch())` as any,
				completionStats: summaryData ? summaryData : null,
				...(success ? { errorMsg: null } : {}),
			};
			const plan = await this.planStore.getById(planId);

			if (plan?.method === 'rescue') {
				// Since rescue does not do a dry run, we backfill the taskStats with the summary data
				// from the completion event, so that it can be used in notifications and elsewhere.
				const shouldBackfillTaskStats = success && summaryData;
				if (shouldBackfillTaskStats) {
					backupPayload.taskStats = { ...summaryData, dry_run: false } as any;
				}
			}

			const backup = await this.backupStore.update(backupId, backupPayload);
			if (!backup) {
				throw new Error('Failed to update Backup entry in Database.');
			}

			// Send Notification
			if (plan && plan.settings.notification) {
				// Include replication failures in the success notification if any mirrors failed
				const replicationFailures = (backup.mirrors || [])
					.filter((m: any) => m.status === 'failed')
					.map((m: any) => ({
						replicationId: m.replicationId,
						storageId: m.storageId,
						storageName: m.storageName,
						storageType: m.storageType,
						error: m.error,
					}));

				await this.backupNotification.send(plan, 'success', {
					id: data.backupId,
					startTime: backup.started || new Date(),
					stats: backup.completionStats || undefined,
					...(replicationFailures.length > 0 ? { replicationFailures } : {}),
				});
			}

			// Log Backup Completion event
			if (success) {
				planLogger('backup', planId, backupId).info(
					`Backup Completed for Backup Plan. Total Duration: ${totalDuration} seconds.`
				);
			} else {
				planLogger('backup', planId, backupId).error(
					`Backup Failed for Backup Plan. Reason: Unknown.`
				);
			}
		} catch (error: any) {
			planLogger('backup', data.planId, data.backupId).error(
				`Error processing backup completion for Backup. Reason : ${
					error?.message.toString() || 'Unknown Error'
				}`
			);
		}
	}

	async onBackupError(data: BackupErrorEvent): Promise<void> {
		try {
			// Update DB with Error
			const backup = await this.backupStore.update(data.backupId, {
				status: 'retrying',
				errorMsg: data.error,
			});
			if (!backup) {
				throw new Error('Failed to update Backup entry in Database.');
			}

			// Log Backup Error event
			planLogger('backup', data.planId, data.backupId).info(
				`Backup Failed for Plan. Reason: ${data.error || 'Unknown Error'}`
			);
		} catch (error: any) {
			planLogger('backup', data.planId, data.backupId).error(
				`Error processing backup failure for Backup. Reason : ${
					error?.message.toString() || 'Unknown Error'
				}`
			);
		}
	}

	async onBackupFailure(data: { planId: string; backupId: string; error: string }): Promise<void> {
		const { planId, backupId, error } = data;
		try {
			// Update DB with Error
			const backup = await this.backupStore.update(backupId, {
				status: 'failed',
				errorMsg: error,
				success: false,
				inProgress: false,
				ended: sql`(unixepoch())` as any,
			});
			if (!backup) {
				throw new Error('Failed to update Backup entry in Database.');
			}

			// Send the permanent failure event to backup handler
			await this.afterPermanentFailure(planId, backupId, error);

			// Send Notification
			const plan = await this.planStore.getById(planId);
			if (plan && plan.settings.notification) {
				await this.backupNotification.send(plan, 'failure', {
					id: backupId,
					startTime: backup.started || new Date(),
					stats: backup.taskStats || undefined,
					error: error,
				});
			}

			// Log Backup Error event
			planLogger('backup', planId, backupId).info(
				`Backup Failed for Plan. Reason: ${error || 'Unknown Error'}`
			);
		} catch (err: any) {
			planLogger('backup', planId, backupId).error(
				`Error processing backup failure for Backup. Reason : ${
					err?.message.toString() || 'Unknown Error'
				}`
			);
		}
	}

	async onBackupStatsUpdate(data: BackupStatUpdateEvent) {
		const { total_size, snapshots = [], backupId, planId, error = '', mirrors } = data;
		if (planId && total_size && !Number.isNaN(total_size) && snapshots.length > 0) {
			try {
				await this.planStore.update(data.planId, {
					stats: {
						size: total_size,
						snapshots: snapshots,
						...(mirrors ? { mirrors } : {}),
					},
					lastBackupTime: sql`(unixepoch())` as any,
				});
				planLogger('update', planId, backupId).info(
					`Updated plan stats for Backup Plan. Total Size: ${total_size} bytes, Total Snapshots: ${snapshots.length || 0} `
				);
			} catch (error: any) {
				planLogger('update', planId, backupId).error(
					`Error updating plan stats for Backup Plan. Reason : ${
						error?.message.toString() || 'Unknown Error'
					}`
				);
			}
		} else {
			if (planId) {
				planLogger('update', planId, backupId).error(
					`Failed to Update plan stats for Backup Plan. Reason: ${error || 'Unknown Error'} `
				);
			}
		}
	}

	async onPruneEnd(data: PruneEndEvent): Promise<void> {
		if (data.success) {
			planLogger('prune', data.planId).info(`Successfully pruned Backups.`);
			const { planId, stats } = data;
			const { total_size, snapshots = [] } = stats || {};
			if (planId && total_size && !Number.isNaN(total_size) && snapshots.length > 0) {
				try {
					await this.planStore.update(data.planId, {
						stats: {
							size: total_size,
							snapshots: snapshots,
						},
						lastBackupTime: sql`(unixepoch())` as any,
					});
					planLogger('update', planId).info(
						`Updated plan stats for Backup Plan. Total Size: ${total_size} bytes, Total Snapshots: ${snapshots.length || 0} `
					);
				} catch (error: any) {}
			}
		} else {
			planLogger('prune', data.planId).error(`Failed to prune Backups. Reason: ${data.error}`);
		}
	}

	/**
	 * Called after a job has permanently failed. Implemented in the PRO version.
	 * @param planId - The ID of the plan that failed.
	 * @param backupId - The ID of the backup that failed.
	 * @param error - The error that caused the failure.

	 */
	async afterPermanentFailure(planId: string, backupId: string, error: string): Promise<void> {
		if (this.localAgent) {
			this.localAgent.emit(`backup_failed_processed_${backupId}`, {
				planId: planId,
				backupId: backupId,
				error: error,
			});
		}
	}

	async onReplicationStatsUpdate(data: {
		planId: string;
		backupId: string;
		mirrors: {
			replicationId: string;
			storageId: string;
			storagePath: string;
			size: number;
			snapshots: string[];
		}[];
	}): Promise<void> {
		const { planId, backupId, mirrors } = data;
		if (!planId || !mirrors || mirrors.length === 0) return;
		try {
			const plan = await this.planStore.getById(planId);
			if (plan && plan.stats) {
				await this.planStore.update(planId, {
					stats: {
						...plan.stats,
						mirrors,
					},
				});
				planLogger('update', planId, backupId).info(
					`Updated plan mirror stats. ${mirrors.length} mirror(s) tracked.`
				);
			}
		} catch (error: any) {
			planLogger('update', planId, backupId).error(
				`Error updating plan mirror stats: ${error?.message || 'Unknown Error'}`
			);
		}
	}

	async onIntegrityStart(data: { planId: string }) {
		const startedAt = new Date().getTime();
		try {
			await this.planStore.update(data.planId, {
				verified: {
					status: 'running',
					startedAt,
					endedAt: null,
					hasError: false,
				},
			});
			planLogger('integrity_check', data.planId).info(`Started Integrity Check for Backup Plan.`);
		} catch (error: any) {
			planLogger('integrity_check', data.planId).error(
				`Error starting Integrity Check for Backup Plan. Reason : ${
					error?.message.toString() || 'Unknown Error'
				}`
			);
		}
	}

	async onIntegrityEnd(data: { planId: string; result: Record<string, string | null> }) {
		const endedAt = new Date().getTime();
		try {
			const thePlan = await this.planStore.getById(data.planId);
			if (thePlan && thePlan.storage?.name && thePlan.device?.id) {
				const parsedResult: Record<string, BackupVerifiedResult> = {};
				let hasIntegrityIssue = false;

				Object.keys(data.result).forEach(async key => {
					const theStorage =
						key === 'primary'
							? thePlan.storage
							: thePlan.settings.replication?.storages?.find(
									m => m.storageId === key.replace('mirror_', '')
								);
					let storageName =
						key === 'primary'
							? (theStorage as PlanStorageItem)?.name
							: (theStorage as PlanReplicationStorage)?.storageName || key;
					if (storageName === 'Local Storage') storageName = 'local';
					const storagePath =
						key === 'primary'
							? thePlan.storagePath
							: (theStorage as PlanReplicationStorage)?.storagePath || '';
					const repoPath = generateResticRepoPath(storageName, storagePath || '');
					const checkResult = handleResticCheckResult(data.result[key] || '', {
						repo: repoPath,
						device: `${thePlan.device?.name}${thePlan.device?.id !== 'main' && thePlan.device?.hostname ? ` (${thePlan.device.hostname})` : ''}`,
					});
					parsedResult[key] = checkResult;
					if (checkResult.hasError) {
						hasIntegrityIssue = true;
					}
				});

				await this.planStore.update(data.planId, {
					verified: {
						status: 'completed',
						startedAt: thePlan.verified?.startedAt || endedAt,
						result: parsedResult as any,
						hasError: hasIntegrityIssue,
						endedAt,
					},
				});
				planLogger('integrity_check', data.planId).info(
					`Completed Integrity Check for Backup Plan.`
				);
			} else {
				planLogger('integrity_check', data.planId).error(`Backup Plan not found.`);
			}
		} catch (error: any) {
			planLogger('integrity_check', data.planId).error(
				`Error completing Integrity Check for Backup Plan. Reason : ${
					error?.message || 'Unknown Error'
				}`
			);
		}
	}

	async onIntegrityFailed(data: { planId: string; error: string }) {
		const thePlan = await this.planStore.getById(data.planId);
		if (thePlan && thePlan.storage?.name && thePlan.device?.id) {
			planLogger('integrity_check', data.planId).error(`Failed Integrity Check for Backup Plan.`);
		} else {
			planLogger('integrity_check', data.planId).error(`Backup Plan not found.`);
		}
	}
}
