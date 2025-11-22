import { EventEmitter } from 'events';
import { getBackupPlanStats, getSnapshotByTag, runResticCommand } from '../utils/restic/restic';
import { generateResticRepoPath, resticPathToWindows } from '../utils/restic/helpers';
import { DownloadHandler } from './handlers/DownloadHandler';
import { configService } from '../services/ConfigService';
import { SnapShotFile } from '../types/restic';

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
		options: { storagePath: string; storageName: string; encryption: boolean; planId: string }
	): Promise<{
		success: boolean;
		result: any;
		stats?: false | { total_size: number; snapshots: string[] };
	}> {
		try {
			const { storageName, storagePath, encryption, planId } = options;
			const repoPassword = encryption ? configService.config.ENCRYPTION_KEY : '';
			const repoPath = generateResticRepoPath(storageName, storagePath || '');
			let snapshotId = '';
			const { success, result } = await getSnapshotByTag('backup-' + backupId, options);
			if (success && typeof result !== 'string') {
				snapshotId = result.id;
			} else {
				return { success, result };
			}

			const output = await runResticCommand(['-r', repoPath, 'forget', snapshotId, '--json'], {
				RESTIC_PASSWORD: repoPassword,
			});
			console.log('[removeSnapshot] restic output:', output);
			const planStats = await getBackupPlanStats(planId, storageName, storagePath, encryption);
			return {
				success: true,
				result: output,
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
		options: { storagePath: string; storageName: string; encryption: boolean }
	): Promise<{ success: boolean; result: SnapShotFile[] | string }> {
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

			return { success: true, result: files };
		} catch (error: any) {
			console.log('getSnapshotFiles error :', error);
			return { success: false, result: error?.message || 'Failed to get snapshot files' };
		}
	}
}
