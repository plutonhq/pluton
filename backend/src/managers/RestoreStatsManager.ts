import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { appPaths } from '../utils/AppPaths';
import { ResticRestoredFile } from '../types/restic';
import getBackupSourceFiles from '../utils/getBackupSourceFiles';
import { RestoreConfig, RestoreStats, RestoreStatsFile } from '../types/restores';
import path from 'path';

export class RestoreStatsManager {
	private statsDirectory: string = '';

	constructor() {
		this.statsDirectory = appPaths.getStatsDir();
	}

	async initialize(
		planId: string,
		backupId: string,
		restoreId: string,
		sources: string[],
		restoreConfig: Record<string, any>
	) {
		const filePath = path.join(this.statsDirectory, `restore-${restoreId}.json`);
		const fileExist = existsSync(filePath);

		// If the file already exists, do nothing and return immediately.
		if (fileExist) {
			return;
		}
		const initialStats: RestoreStatsFile = {
			planId,
			backupId,
			restoreId,
			sources,
			config: restoreConfig,
			sourcePaths: [],
			restoredPaths: [],
			stats: {
				total_files: 0,
				files_restored: 0,
				total_bytes: 0,
				bytes_restored: 0,
			},
		};

		if (sources.length > 0) {
			const sourcePaths = await getBackupSourceFiles(sources);
			if (sourcePaths.result && Array.isArray(sourcePaths.result)) {
				initialStats.sourcePaths = sourcePaths.result;
			}
		}

		try {
			const filePath = path.join(this.statsDirectory, `restore-${restoreId}.json`);
			const fileExist = existsSync(filePath);
			if (!fileExist) {
				await writeFile(filePath, JSON.stringify(initialStats, null, 2), 'utf-8');
			}
		} catch (error: any) {
			console.error(
				`[RestoreHandler]: Failed to write initial stats for restoreId: ${restoreId}. Error: ${error.message}`
			);
		}
	}

	async update(restoreId: string, files: ResticRestoredFile[], stats: RestoreStats): Promise<void> {
		// Update progress for a specific restore operation
		const filePath = path.join(this.statsDirectory, `restore-${restoreId}.json`);
		try {
			const statsContent = await readFile(filePath, 'utf-8');
			const updatedStats = { ...JSON.parse(statsContent), restoredPaths: files, stats: stats };
			await writeFile(filePath, JSON.stringify(updatedStats, null, 2), 'utf-8');
		} catch (error: any) {
			console.error(
				`[RestoreHandler]: Failed to update stats for restoreId: ${restoreId}. Error: ${error.message}`
			);
		}
	}
}
