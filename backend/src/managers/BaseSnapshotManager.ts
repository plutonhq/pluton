import { EventEmitter } from 'events';
import { readFile, writeFile } from 'fs/promises';
import { getBackupPlanStats, getSnapshotByTag, runResticCommand } from '../utils/restic/restic';
import { generateResticRepoPath, resticPathToWindows } from '../utils/restic/helpers';
import { DownloadHandler } from './handlers/DownloadHandler';
import { configService } from '../services/ConfigService';
import { SnapShotFile } from '../types/restic';
import { appPaths } from '../utils/AppPaths';
import { jobQueue } from '../jobs/JobQueue';

export class BaseSnapshotManager extends EventEmitter {
	private downloadHandler: DownloadHandler;

	constructor() {
		super();
		this.downloadHandler = new DownloadHandler(this);
	}

	async listSnapshots(): Promise<string> {
		return runResticCommand(['snapshots', '--json']);
	}

	async downloadSnapshot(
		planId: string,
		backupId: string,
		snapShotPath: string,
		options: { storagePath: string; storageName: string; encryption: boolean }
	): Promise<any> {
		try {
			// First get the Snapshot ID
			const { success, result } = await getSnapshotByTag('backup-' + backupId, options);
			if (success && typeof result !== 'string') {
				this.downloadHandler.download(planId, backupId, result.id, options);
				return {
					success: true,
					result: 'Generating Download..',
				};
			} else {
				return { success, result };
			}
		} catch (error: any) {
			return {
				success: false,
				result: error?.message || '',
			};
		}
	}

	async getSnapshotDownload(planId: string, backupId: string): Promise<any> {
		try {
			const result = await this.downloadHandler.get(planId, backupId);
			return {
				success: true,
				result: result,
			};
		} catch (error: any) {
			return {
				success: false,
				result: error?.message || '',
			};
		}
	}

	async cancelSnapshotDownload(planId: string, backupId: string): Promise<any> {
		try {
			const result = await this.downloadHandler.cancel(planId, backupId);
			return {
				success: result,
				result: 'Download cancelled',
			};
		} catch (error: any) {
			return {
				success: false,
				result: error?.message || '',
			};
		}
	}

	async removeSnapshot(
		planId: string,
		backupId: string,
		options: {
			storagePath: string;
			storageName: string;
			encryption: boolean;
			mirrors?: { replicationId: string; storageName: string; storagePath: string }[];
		}
	): Promise<{
		success: boolean;
		result: any;
		stats?: {
			primary: null | { total_size: number; snapshots: string[] };
			mirrors?: { [key: string]: { total_size: number; snapshots: string[] } };
		};
	}> {
		try {
			const { storageName, storagePath, encryption } = options;
			const repoPassword = encryption ? configService.config.ENCRYPTION_KEY : '';
			const reposToRemove: { id: string; name: string; path: string }[] = [
				{ id: 'primary', name: storageName, path: storagePath },
			];
			const planStats: {
				primary: null | { total_size: number; snapshots: string[] };
				mirrors?: { [key: string]: { total_size: number; snapshots: string[] } };
			} = {
				primary: null,
				mirrors: {},
			};
			const removalOutput: Record<string, string> = {};
			if (options.mirrors) {
				options.mirrors.forEach(mirror => {
					reposToRemove.push({
						id: mirror.replicationId,
						name: mirror.storageName,
						path: mirror.storagePath,
					});
				});
			}
			for (const repo of reposToRemove) {
				const repoPath = generateResticRepoPath(repo.name, repo.path || '');
				const { success, result } = await getSnapshotByTag('backup-' + backupId, {
					storageName: repo.name,
					storagePath: repo.path,
					encryption,
				});
				if (!success || typeof result === 'string') {
					continue;
				}
				const snapshotId = result.id;

				const output = await runResticCommand(['-r', repoPath, 'forget', snapshotId, '--json'], {
					RESTIC_PASSWORD: repoPassword,
				});
				removalOutput[repo.id] = output;
				const repoStats = await getBackupPlanStats(planId, repo.name, repo.path, encryption);
				if (repo.id === 'primary') {
					planStats.primary = repoStats || { total_size: 0, snapshots: [] };
				} else if (repoStats) {
					planStats.mirrors![repo.id] = repoStats;
				}
			}
			return {
				success: true,
				result: removalOutput,
				stats: planStats,
			};
		} catch (error: any) {
			return {
				success: false,
				result: error?.message || '',
			};
		}
	}

	async getSnapshotFiles(
		backupId: string,
		options: { storagePath: string; storageName: string; encryption: boolean; skipCache?: boolean }
	): Promise<{ success: boolean; result: SnapShotFile[] | string }> {
		const filename = `backup-${backupId}-snapshot.json`;
		const snapshotFilePath = `${appPaths.getCacheDir()}/${filename}`;

		if (!options.skipCache) {
			try {
				const snapshotCache = await readFile(snapshotFilePath, 'utf8');
				const files = JSON.parse(snapshotCache);
				return { success: true, result: files };
			} catch (error: any) {}
		}

		try {
			let snapshotId: string | undefined;
			const { success, result } = await getSnapshotByTag('backup-' + backupId, options);
			if (success && typeof result !== 'string') {
				snapshotId = result.id;
			} else {
				return { success: false, result: 'Snapshot not found' };
			}
			const { storageName, storagePath, encryption } = options;
			const repoPassword = encryption ? configService.config.ENCRYPTION_KEY : '';
			const repoPath = generateResticRepoPath(storageName, storagePath || '');
			const output = await runResticCommand(
				['ls', '-r', repoPath, snapshotId, '--json', '--long'],
				{
					RESTIC_PASSWORD: repoPassword,
				}
			);

			const outputJSON = output
				.split(/\r?\n/)
				.filter(line => line.trim() !== '')
				.map(item => JSON.parse(item));
			// Parse JSON output into structured data
			const files: SnapShotFile[] = outputJSON
				.filter(item => item.path !== undefined)
				.map((item: any) => ({
					name: item.name,
					path: item.path,
					srcPath:
						process.platform === 'win32'
							? resticPathToWindows(item.path)
							: item.path.replace(/\\/g, '/'),
					type: item.type,
					isDirectory: item.type === 'dir',
					size: item.size || 0,
					modifiedAt: item.mtime,
					owner: '',
					permissions: item.permissions,
					isAvailable: true,
				}));

			// write the cache (skip for mirror storage reads to avoid polluting primary cache)
			if (!options.skipCache) {
				await writeFile(snapshotFilePath, JSON.stringify(files), 'utf8');
			}

			return { success: true, result: files };
		} catch (error: any) {
			console.log('getSnapshotFiles error :', error);
			return { success: false, result: error?.message || 'Failed to get snapshot files' };
		}
	}

	async retryFailedReplication(
		planId: string,
		backupId: string,
		replicationIds: string[]
	): Promise<{ success: boolean; result: string }> {
		jobQueue.add('ReplicationRetry', {
			planId: planId,
			backupId,
			failedReplicationIds: replicationIds,
		});

		return { success: true, result: 'Replication retry queued' };
	}
}
