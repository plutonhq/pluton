import { PlanStore } from '../../stores/PlanStore';
import { BackupStore } from '../../stores/BackupStore';
import { RestoreStore } from '../../stores/RestoreStore';
import { readFile } from 'fs/promises';
import { planLogger } from '../../utils/logger';
import { appPaths } from '../../utils/AppPaths';
import { NewRestore, restoreInsertSchema } from '../../db/schema/restores';
import { SourceTypes } from '../../types/source';
import { RestoreCompleteEvent, RestoreErrorEvent, RestoreStartEvent } from '../../types/events';
import { BaseRestoreManager } from '../../managers/BaseRestoreManager';
import { eventDate } from '../../utils/eventTime';

export class RestoreEventService {
	constructor(
		protected planStore: PlanStore,
		protected backupStore: BackupStore,
		protected restoreStore: RestoreStore,
		protected localAgent?: BaseRestoreManager
	) {}

	async onRestoreStart(data: RestoreStartEvent) {
		try {
			const { planId, backupId, restoreId, config, stats } = data;

			const theBackup = await this.backupStore.getById(backupId);
			if (!theBackup) {
				planLogger('restore', planId, backupId).error(
					`Failed to start restore process as backup ${data.backupId} does not exist`
				);
				return;
			}

			// Validate and Parse the data
			const newRestore: NewRestore = {
				id: restoreId,
				backupId: theBackup.id as string,
				taskStats: stats,
				status: 'started',
				inProgress: true,
				config: {
					target: config?.target,
					overwrite: config?.overwrite || 'always',
					includes: config?.includes || [],
					excludes: config?.excludes || [],
					delete: config?.delete || false,
				},
				storageId: theBackup.storageId,
				planId: theBackup.planId,
				sourceId: theBackup.sourceId,
				sourceType: theBackup.sourceType,
				method: theBackup.method,
			};
			let parsedRestoreData = { ...newRestore };
			try {
				const parsedRestoreDataRaw = restoreInsertSchema.parse(newRestore);
				parsedRestoreData = {
					...parsedRestoreDataRaw,
					sourceType: parsedRestoreDataRaw.sourceType as SourceTypes,
				};
			} catch (error: any) {
				console.error('Error parsing settings data:', error);
				planLogger('restore', planId, backupId).error(
					`Error parsing Restore Data provided by the source. ${error?.message || 'Unknown Error'}`
				);
				return;
			}

			// A queued restore reuses its restoreId across retries. Reuse the row
			// rather than attempting a second insert with the same primary key, so
			// each retry can emit restoreCreated and leave pre-restore.
			const existingRestore = await this.restoreStore.getById(restoreId);
			const restore = existingRestore
				? await this.restoreStore.update(restoreId, {
						backupId: parsedRestoreData.backupId,
						planId: parsedRestoreData.planId,
						storageId: parsedRestoreData.storageId,
						sourceId: parsedRestoreData.sourceId,
						sourceType: parsedRestoreData.sourceType,
						method: parsedRestoreData.method,
						taskStats: parsedRestoreData.taskStats,
						config: parsedRestoreData.config,
						status: 'started',
						inProgress: true,
						errorMsg: null,
					})
				: await this.restoreStore.create(parsedRestoreData);

			if (!restore) {
				throw new Error('Failed to create restore entry in the Database');
			}
			// Emit the restore created event
			if (this.localAgent) {
				this.localAgent.emit('restoreCreated', {
					backupId: data.backupId,
					restoreId: restore.id,
				});
			}
			planLogger('restore', planId, backupId).info(
				`Restore process started for backup ${backupId}`
			);
		} catch (error: any) {
			if (data.planId && data.backupId) {
				planLogger('restore', data.planId, data.backupId).error(
					`Failed to handle restore start for backup ${data.backupId}: ${error.message}`
				);
			}
		}
	}

	/**
	 * A cancelled restore is terminal: the user asked for it and cancelRestore
	 * already recorded it. A remote agent still reports its killed run as an
	 * ordinary failure, so those late events must not overwrite the status.
	 */
	protected async wasCancelled(restoreId: string): Promise<boolean> {
		const restore = await this.restoreStore.getById(restoreId);
		return restore?.status === 'cancelled';
	}

	async onRestoreError(eventPayload: RestoreErrorEvent) {
		const { backupId, restoreId, planId, error } = eventPayload;
		if (!backupId || !planId || !error) {
			return;
		}
		try {
			if (restoreId && (await this.wasCancelled(restoreId))) {
				return;
			}

			if (restoreId) {
				await this.restoreStore.update(restoreId, {
					status: 'error',
					errorMsg: error,
					inProgress: true,
					ended: eventDate((eventPayload as { occurredAt?: number }).occurredAt),
				});
			}

			planLogger('restore', planId, backupId).error(
				`Restore process failed for backup #${backupId}. Reason: ${error || 'Unknown'}`
			);
		} catch (error: any) {
			planLogger('restore', planId, backupId).error(
				`Failed to handle restore error for backup #${backupId}: ${error.message}`
			);
		}
	}

	async onRestoreFailed(eventPayload: RestoreErrorEvent) {
		const { backupId, restoreId, planId, error } = eventPayload;
		if (!backupId || !planId || !restoreId || !error) {
			return;
		}
		try {
			if (await this.wasCancelled(restoreId)) {
				return;
			}

			if (restoreId) {
				await this.restoreStore.update(restoreId, {
					status: 'failed',
					errorMsg: error,
					inProgress: false,
					ended: eventDate((eventPayload as { occurredAt?: number }).occurredAt),
				});
			}

			planLogger('restore', planId, backupId).error(
				`Restore process failed for backup #${backupId}. Reason: ${error || 'Unknown'}`
			);
		} catch (error: any) {
			planLogger('restore', planId, backupId).error(
				`Failed to handle restore error for backup #${backupId}: ${error.message}`
			);
		}
	}

	async onRestoreComplete(eventPayload: RestoreCompleteEvent) {
		const { backupId, restoreId, planId, success } = eventPayload;
		if (!backupId || !planId || !restoreId || success === undefined) {
			return;
		}
		try {
			if (!success && (await this.wasCancelled(restoreId))) {
				return;
			}

			const progressFile = `${appPaths.getProgressDir()}/restore-${restoreId}.json`;
			let progressData;

			try {
				progressData = JSON.parse(await readFile(progressFile, 'utf8'));
			} catch (error: any) {}

			await this.restoreStore.update(restoreId, {
				status: success ? 'completed' : 'failed',
				inProgress: false,
				ended: eventDate((eventPayload as { occurredAt?: number }).occurredAt),
				completionStats: progressData?.data,
			});

			// if (existsSync(progressFile)) {
			// 	await unlink(progressFile);
			// }
			planLogger('restore', planId, backupId).info(
				`Restore process completed for backup ${backupId}.`
			);
		} catch (error: any) {
			console.log('[ERROR] handleRestoreComplete:', error);
			planLogger('restore', planId, backupId).error(
				`Failed to handle restore completion for backup ${backupId}. Reason: ${error?.message || 'Unknown'}`
			);
		}
	}
}
