import { EventEmitter } from 'events';
import { getBackupPlanStats, runResticCommand } from '../../utils/restic/restic';
import { generateResticRepoPath } from '../../utils/restic/helpers';

export class PruneHandler {
	constructor(private emitter: EventEmitter) {}

	async prune(
		planId: string,
		options: Record<string, any>,
		updateStats: boolean = false
	): Promise<{
		success: boolean;
		result: string;
	}> {
		// const pruneResult = { policy: [], keepLast: [] };
		let pruneErrorMsg = '';

		// Generate restic Prune Command
		const prune = options.settings.prune;
		const { resticArgs, policyArgs, resticEnv } = this.generatePruneCommand(planId, options);

		// Perform the Prune
		try {
			const countFilterArgs = [...resticArgs];
			// The policy prunes and the --keep-last prune should be ran separately
			// The --keep-last prune should be ran after the policy prune.

			if (prune.snapCount) {
				countFilterArgs.push('--keep-last', prune.snapCount.toString());
				await runResticCommand([...resticArgs, ...policyArgs], resticEnv);
				await runResticCommand(countFilterArgs, resticEnv);
			} else {
				await runResticCommand([...resticArgs, ...policyArgs], resticEnv);
			}

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
			this.emitter.emit('pruneEnd', {
				planId,
				success: false,
				error: error?.message || 'Unknown Error',
			});
			pruneErrorMsg = error?.message || 'Unknown Error';
		}

		return {
			success: pruneErrorMsg ? false : true,
			result: pruneErrorMsg ? pruneErrorMsg : 'Pruned Old Snapshots Successfully.',
		};
	}

	private generatePruneCommand(planId: string, options: Record<string, any>) {
		const { storagePath, storage, settings } = options;
		const { prune, encryption = true } = settings;
		const resticArgs = ['forget', '--prune', '--tag', `plan-${planId}`];
		const policyArgs: string[] = [];
		const resticEnv = { RESTIC_PASSWORD: encryption ? (process.env.ENCRYPTION_KEY as string) : '' };

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
				if (prune.forgetAge) {
					policyArgs.push('--keep-within', prune.forgetAge);
				}
				break;

			case 'forgetByDate':
				if (prune.forgetDate) {
					policyArgs.push('--keep-before', prune.forgetDate);
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
