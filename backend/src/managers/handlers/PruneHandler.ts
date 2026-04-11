import { EventEmitter } from 'events';
import { getBackupPlanStats, runResticCommand } from '../../utils/restic/restic';
import { generateResticRepoPath } from '../../utils/restic/helpers';
import { configService } from '../../services/ConfigService';

export class PruneHandler {
	constructor(private emitter: EventEmitter) {}

	async prune(
		planId: string,
		options: Record<string, any>,
		updateStats: boolean = false
	): Promise<{ success: boolean; result: string }> {
		let pruneErrorMsg = '';
		const prune = options.settings.prune;

		// Check if pruning is disabled
		if (prune.policy === 'disable') {
			this.emitter.emit('pruneEnd', { planId, success: true, stats: null });
			return { success: true, result: 'Pruning is disabled for this plan.' };
		}

		// Generate restic Prune Command
		const { resticArgs, policyArgs, resticEnv } = this.generatePruneCommand(planId, options);

		// Combine ALL policy args into ONE command to ensure Restic's native "OR" logic applies safely.
		const finalCommandArgs = [...resticArgs, ...policyArgs];

		// ALWAYS keep at least 1 backup, regardless of policy or user input.
		// This prevents age-based policies from deleting the final backup if backups stop running.
		const safeKeepLast = Math.max(1, Number(prune.snapCount) || 1).toString();
		finalCommandArgs.push('--keep-last', safeKeepLast);

		try {
			// Execute the combined command ONCE
			await runResticCommand(finalCommandArgs, resticEnv);

			let planStats;
			if (updateStats) {
				planStats = await getBackupPlanStats(
					planId,
					options.storage.name,
					options.storagePath,
					options.settings.encryption
				);
			}

			this.emitter.emit('pruneEnd', { planId, success: true, stats: planStats });
		} catch (error: any) {
			pruneErrorMsg = error?.message || 'Unknown Error';
			this.emitter.emit('pruneEnd', { planId, success: false, error: pruneErrorMsg });
		}

		return {
			success: !pruneErrorMsg,
			result: pruneErrorMsg ? pruneErrorMsg : 'Pruned Old Snapshots Successfully.',
		};
	}

	private generatePruneCommand(planId: string, options: Record<string, any>) {
		const { storagePath, storage, settings } = options;
		const { prune, encryption = true } = settings;

		const resticArgs = ['forget', '--prune', '--tag', `plan-${planId}`];
		const policyArgs: string[] = [];
		const resticEnv = { RESTIC_PASSWORD: encryption ? configService.config.ENCRYPTION_KEY : '' };

		if (storage.name) {
			const repoPath = generateResticRepoPath(storage.name, storagePath || '');
			resticArgs.push('-r', repoPath);
		}

		switch (prune.policy) {
			case 'custom':
				if (prune.keepDailySnaps) policyArgs.push('--keep-daily', prune.keepDailySnaps.toString());
				if (prune.keepWeeklySnaps)
					policyArgs.push('--keep-weekly', prune.keepWeeklySnaps.toString());
				if (prune.keepMonthlySnaps)
					policyArgs.push('--keep-monthly', prune.keepMonthlySnaps.toString());
				break;

			case 'forgetByAge':
				// This uses --keep-within. (e.g. "30d", "2m")
				if (prune.forgetAge) {
					policyArgs.push('--keep-within', prune.forgetAge);
				}
				break;
		}

		if (encryption === false) {
			resticArgs.push('--insecure-no-password');
		}
		resticArgs.push('--json');

		return { resticArgs, resticEnv, policyArgs };
	}
}
