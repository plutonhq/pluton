import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
import { getRcloneConfigPath } from '../rclone/helpers';
import { ResticRawStats, ResticSnapshot } from '../../types/restic';
import { getBinaryPath } from '../binaryPathResolver';
import { appPaths } from '../AppPaths';
import { generateResticRepoPath } from './helpers';
import { configService } from '../../services/ConfigService';

export function runResticCommand(
	args: string[],
	env?: Record<string, string>,
	onProgress?: (data: Buffer) => void,
	onError?: (data: Buffer) => void,
	onComplete?: (code: number) => void,
	onProcess?: (process: any) => void
): Promise<string> {
	let lastProgressTime = 0;
	const THROTTLE_INTERVAL = 2000; // 2 seconds
	const localAppData = process.env.LOCALAPPDATA || os.homedir();
	return new Promise((resolve, reject) => {
		const resticBinary = getBinaryPath('restic');
		const rcloneBinaryPath = getBinaryPath('rclone');
		const rcloneDir = path.dirname(rcloneBinaryPath);
		const rcloneExecutable = path.basename(rcloneBinaryPath);

		const rcloneConfigPath = getRcloneConfigPath();

		// Construct new PATH ensuring rclone directory is included
		// We check for both PATH and Path to be safe on Windows, though Node.js usually handles this.
		const currentPath = env?.PATH || process.env.PATH || process.env.Path || '';
		const newPath = `${rcloneDir}${path.delimiter}${currentPath}`;

		const envVars = {
			// ...process.env,
			...env,
			PATH: newPath,
			RCLONE_CONFIG: rcloneConfigPath,
			// RCLONE_PROGRESS: 'true',
			LOCALAPPDATA: localAppData,
			RCLONE_CONFIG_PASS: configService.config.ENCRYPTION_KEY,
		};

		const finalArgs = [
			...args,
			'-o',
			`rclone.program=${rcloneExecutable}`,
			'--cache-dir',
			path.join(appPaths.getTempDir(), 'restic-cache'),
		];

		console.log('runResticCommand :', [resticBinary, ...finalArgs], envVars);

		const resticProcess = spawn(resticBinary, finalArgs, { env: envVars });

		if (onProcess) {
			onProcess(resticProcess);
		}
		let output = '';
		let errorOutput = '';
		let wasCancelled = false;
		let hasExited = false;

		// Handle User exit gracefully
		resticProcess.on('exit', (code, signal) => {
			if (signal === 'SIGTERM') {
				wasCancelled = true;
				resolve('Process terminated by user');
				return;
			}
			hasExited = true;
		});

		// Handle Restic Run Errors
		resticProcess.on('error', error => {
			const errorMsg = `Failed to run restic : ${error.message}`;
			onError?.(Buffer.from(errorMsg));
			reject(new Error(errorMsg));
		});

		// Handle Restic Output Messages
		resticProcess.stdout?.on('data', (data: Buffer) => {
			output += data.toString();
			const currentTime = Date.now();
			try {
				const message = JSON.parse(data.toString());
				// console.log('[runResticCommand] Progress data :', message);
				if (
					message?.message_type &&
					(message.message_type === 'status' || message.message_type === 'verbose_status')
				) {
					// Throttle progress updates
					if (currentTime - lastProgressTime >= THROTTLE_INTERVAL) {
						const scanData = Buffer.from(
							JSON.stringify({
								type: 'scan',
								...message,
							})
						);
						onProgress?.(scanData);
						lastProgressTime = currentTime;
					}
				} else {
					onProgress?.(data);
				}
			} catch {
				onProgress?.(data);
			}
		});

		// Handle Error Messages
		resticProcess.stderr?.on('data', (data: Buffer) => {
			if (!wasCancelled) {
				console.log('restic output Error :', data.toString());
				errorOutput += data.toString();

				// NOTE: The onError callback is disabled because rclone/restic always retries the backup task.
				// The error is handled in process.on('close'
				// onError?.(data);
			}
		});

		// Handle Process Exit
		resticProcess.on('close', (code: number) => {
			// console.log('Restic Process exited with code:', code);
			if (!wasCancelled) {
				onComplete?.(code);
				if (code === 0) {
					resolve(output.trim());
				} else {
					console.log('Restic Error :', errorOutput.trim() || 'Restic command failed');
					const error = new Error(errorOutput.trim() || 'Restic command failed');
					onError?.(Buffer.from(error.message));
					reject(error);
				}
			}
		});
	});
}

export async function getBackupPlanStats(
	planId: string,
	storageName: string,
	storagePath: string,
	encryption: boolean
): Promise<false | { total_size: number; snapshots: string[] }> {
	if (!planId || !storageName || !storagePath) {
		return false;
	}
	// TODO: Run restic snapshot list command targeting the tag `plan-${planId}` with getSnapshotByTag
	// run both the stats and the snapshot command simultaneously and return the result to the caller.
	const repoPath = generateResticRepoPath(storageName, storagePath);
	const repoPass = encryption ? configService.config.ENCRYPTION_KEY : '';
	const resticEnv = { RESTIC_PASSWORD: repoPass };
	const statsArgs = [
		'stats',
		'--json',
		'-r',
		repoPath,
		'--tag',
		'plan-' + planId,
		'--mode',
		'raw-data',
	];
	const snapshotsArgs = ['-r', repoPath, 'snapshots', '--tag', `plan-${planId}`, '--json'];
	try {
		// First get the actual repo size
		const statsOutput = await runResticCommand(statsArgs, resticEnv);
		const theStats = JSON.parse(statsOutput) as ResticRawStats;
		// console.log('statsOutput :', statsOutput);

		// Then get the backup ids from the active snapshots
		const snapRes = await runResticCommand(snapshotsArgs, resticEnv);
		const snapshots: ResticSnapshot[] = JSON.parse(snapRes);

		const snapshotBackupIds: string[] = [];
		snapshots.forEach(snap => {
			const backupIdTag = snap.tags.find(tag => tag.startsWith('backup-'));
			if (backupIdTag) {
				snapshotBackupIds.push(backupIdTag.replace('backup-', ''));
			}
		});
		console.log('snapshotBackupIds :', snapshotBackupIds);

		return {
			total_size: theStats.total_size,
			snapshots: snapshotBackupIds,
		};
	} catch (error: any) {
		return false;
	}
}

export async function getSnapshotByTag(
	tag: string,
	options: { storagePath: string; storageName: string; encryption: boolean }
): Promise<{ success: boolean; result: ResticSnapshot | string }> {
	const { storageName, storagePath, encryption } = options;
	const repoPassword = encryption ? configService.config.ENCRYPTION_KEY : '';
	const repoPath = generateResticRepoPath(storageName, storagePath);
	const failedObj = { success: false, result: 'Snapshot Not Found' };
	try {
		const snapshotResticArgs = ['-r', repoPath, 'snapshots', '--tag', tag, '--json'];
		const snapRes = await runResticCommand(snapshotResticArgs, {
			RESTIC_PASSWORD: repoPassword,
		});
		console.log('snapRes :', snapRes);
		if (snapRes) {
			const snapResArr = JSON.parse(snapRes);
			if (Array.isArray(snapResArr) && snapResArr[0] && snapResArr[0].id) {
				const snapshot: ResticSnapshot = snapResArr[0];
				return {
					success: true,
					result: snapshot,
				};
			} else {
				return failedObj;
			}
		} else {
			return failedObj;
		}
	} catch (error: any) {
		return {
			...failedObj,
			result: 'Snapshot Not Found. ' + error?.message,
		};
	}
}
