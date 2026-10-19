import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
import { getRcloneConfigPath } from '../rclone/helpers';
import { ResticRawStats, ResticSnapshot } from '../../types/restic';
import { getBinaryPath } from '../binaryPathResolver';
import { appPaths } from '../AppPaths';
import { generateResticRepoPath } from './helpers';
import { configService } from '../../services/ConfigService';
import { buildResticEnvFromSettings, buildRcloneEnvFromSettings } from '../globalSettings';
import { BackupVerifiedResult } from '../../types/plans';
import { runHelper } from '../linuxHelper';
import { ResticExitCode } from './exitCodes';
import { KillableProcess, killProcessTree } from '../processTree';
import {
	protectedStorageEnvironment,
	trustEnvironment,
	redactStorageOutput,
} from '../storageSecurity';

export type ResticCommandError = Error & {
	code?: number;
	stderr?: string;
	timedOut?: boolean;
	stalled?: boolean;
};

// Cap retained stdout/stderr to avoid exceeding V8's max string size on long
// streaming backups. 1 MiB is plenty for a final summary line or error trace.
const MAX_RETAINED_OUTPUT = 1024 * 1024;

function appendBounded(current: string, chunk: string): string {
	const combined = current + chunk;
	return combined.length > MAX_RETAINED_OUTPUT ? combined.slice(-MAX_RETAINED_OUTPUT) : combined;
}

export function runResticCommand(
	args: string[],
	env?: Record<string, string>,
	onProgress?: (data: Buffer) => void,
	onError?: (data: Buffer) => void,
	onComplete?: (code: number) => void,
	onProcess?: (process: any) => void,
	options?: { timeout?: number; stallTimeout?: number }
): Promise<string> {
	let lastProgressTime = 0;
	const THROTTLE_INTERVAL = 2000; // 2 seconds
	const localAppData = process.env.LOCALAPPDATA || os.homedir();

	// Long-running streaming commands (backup/restore/copy with --json) can emit
	// hundreds of MB of progress JSON. When a progress callback is wired up we
	// drop stdout entirely to avoid OOM. Dry-runs still need the trailing
	// summary line, so we keep a bounded tail and extract the last line.
	const cmd = args[0];
	const isStreaming =
		!!onProgress && (cmd === 'backup' || cmd === 'restore' || args.includes('copy'));
	const isStreamingDryRun = isStreaming && cmd === 'backup' && args.includes('--dry-run');

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

		// Inject global restic & rclone settings from data/config/*.json
		const globalResticEnv = buildResticEnvFromSettings();
		const globalRcloneEnv = buildRcloneEnvFromSettings();

		const envVars = {
			...protectedStorageEnvironment(args),
			...globalResticEnv,
			...globalRcloneEnv,
			...env, // Per-call overrides still take precedence
			PATH: newPath,
			RCLONE_CONFIG: rcloneConfigPath,
			LOCALAPPDATA: localAppData,
			RCLONE_CONFIG_PASS: configService.config.ENCRYPTION_KEY,
			...trustEnvironment(),
		};

		const finalArgs = [
			...args,
			'-o',
			`rclone.program=${rcloneExecutable}`,
			'--cache-dir',
			path.join(appPaths.getTempDir(), 'restic-cache'),
		];

		// console.log('🎷', 'restic ', finalArgs.join(' '));

		// if an empty password is passed, it means encryption is disabled, so we avoid restic prompting for a password
		if ((envVars as Record<string, string>)?.RESTIC_PASSWORD === '') {
			finalArgs.push('--insecure-no-password');
		}

		// detached on POSIX gives the child its own process group (setsid) so
		// killProcessTree can reach restic and its rclone child with kill(-pid).
		const resticProcess = spawn(resticBinary, finalArgs, {
			env: envVars,
			detached: process.platform !== 'win32',
		});

		if (onProcess) {
			onProcess(resticProcess);
		}
		let output = '';
		let errorOutput = '';
		let wasCancelled = false;

		// When a timeout is provided we kill the process and reject with a `timedOut` error.
		let timedOut = false;
		let stalled = false;
		let timeoutHandle: NodeJS.Timeout | undefined;
		let stallInterval: NodeJS.Timeout | undefined;
		let lastActivity = Date.now();
		const timeoutMs = options?.timeout;
		const stallTimeoutMs = options?.stallTimeout;
		const clearTimers = () => {
			if (timeoutHandle) {
				clearTimeout(timeoutHandle);
				timeoutHandle = undefined;
			}
			if (stallInterval) {
				clearInterval(stallInterval);
				stallInterval = undefined;
			}
		};

		if (timeoutMs && timeoutMs > 0) {
			timeoutHandle = setTimeout(() => {
				timedOut = true;
				clearTimers();
				// A restic repository can use rclone as a child process. Kill the
				// whole tree at the hard deadline so it cannot leave its transport alive.
				killProcessTree(resticProcess as KillableProcess, 'SIGKILL');
				const timeoutError: ResticCommandError = new Error(
					`Restic command timed out after ${timeoutMs}ms`
				);
				timeoutError.timedOut = true;
				reject(timeoutError);
			}, timeoutMs);
		}

		// Watchdog: if the child gives no output for stallTimeout, it is stuck
		// (sleep, VPN drop, NAS offline). Kill it so the job queue does not lock.
		if (stallTimeoutMs && stallTimeoutMs > 0) {
			const STALL_POLL_INTERVAL = 60_000;
			stallInterval = setInterval(() => {
				if (Date.now() - lastActivity < stallTimeoutMs) return;
				stalled = true;
				clearTimers();
				// Kill the whole tree so the stuck rclone releases the repo lock.
				killProcessTree(resticProcess as KillableProcess, 'SIGTERM');
				const stallError: ResticCommandError = new Error(
					`Restic command stalled: no output for ${Math.round(stallTimeoutMs / 60000)} minute(s)`
				);
				stallError.stalled = true;
				reject(stallError);
			}, STALL_POLL_INTERVAL);
		}

		// Handle User exit gracefully
		resticProcess.on('exit', (code, signal) => {
			clearTimers();
			if (timedOut || stalled) return;
			// On Windows taskkill reports code 1 / signal null, so also check the
			// marker that killProcessTree sets on the tracked process.
			if (signal === 'SIGTERM' || (resticProcess as KillableProcess).__plutonKilled) {
				wasCancelled = true;
				reject(new Error('Process terminated by user'));
				return;
			}
		});

		// Handle Restic Run Errors
		resticProcess.on('error', error => {
			clearTimers();
			if (timedOut || stalled) return;
			const errorMsg = `Failed to run restic : ${error.message}`;
			onError?.(Buffer.from(errorMsg));
			reject(new Error(errorMsg));
		});

		// Handle Restic Output Messages
		resticProcess.stdout?.on('data', (data: Buffer) => {
			lastActivity = Date.now();
			const stdoutText = data.toString();
			if (!isStreaming) {
				output += stdoutText;
			} else if (isStreamingDryRun) {
				output = appendBounded(output, stdoutText);
			}
			const currentTime = Date.now();
			try {
				const message = JSON.parse(stdoutText);
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
			lastActivity = Date.now();
			if (!wasCancelled) {
				const safeError = redactStorageOutput(data.toString(), envVars);
				console.log('restic output Error :', safeError);
				errorOutput = appendBounded(errorOutput, safeError);

				// NOTE: The onError callback is disabled because rclone/restic always retries the backup task.
				// The error is handled in process.on('close'
				// onError?.(data);
			}
		});

		// Handle Process Exit
		resticProcess.on('close', (code: number) => {
			// console.log('Restic Process exited with code:', code);
			clearTimers();
			if (timedOut || stalled) return;
			if (!wasCancelled) {
				onComplete?.(code);
				const isBackupWarning = cmd === 'backup' && code === ResticExitCode.IncompleteBackup;
				if (code === 0 || isBackupWarning) {
					let result = output.trim();
					if (isStreamingDryRun) {
						// Only the final summary line is meaningful for dry-runs.
						const lines = result.split(/\r?\n/).filter(line => line.trim());
						result = lines[lines.length - 1] ?? '';
					}
					resolve(result);
				} else {
					const stderr = errorOutput.trim();
					console.log('Restic Error :', stderr || 'Restic command failed');
					const error: ResticCommandError = new Error(
						stderr || 'Restic command failed with code ' + code
					);
					error.code = code;
					error.stderr = stderr;
					onError?.(Buffer.from(error.message));
					reject(error);
				}
			}
		});
	});
}

export function runHelperRestore(
	args: string[],
	onProgress?: (data: Buffer) => void,
	onError?: (data: Buffer) => void,
	onComplete?: (code: number | null) => void,
	onProcess?: (process: any) => void
): Promise<string> {
	const helperArgs = args[0] === 'restore' ? args.slice(1) : args;
	return runHelper('restore', helperArgs, {
		onStdout: onProgress,
		onStderr: onError,
		onComplete,
		onProcess,
	});
}

export async function getBackupPlanStats(
	planId: string,
	storageName: string,
	storagePath: string,
	encryption: boolean,
	timeout?: number
): Promise<false | { total_size: number; snapshots: string[] }> {
	if (!planId || !storageName || !storagePath) {
		return false;
	}
	const deadline = timeout && timeout > 0 ? Date.now() + timeout : undefined;
	const remainingTimeout = () =>
		deadline !== undefined ? Math.max(1, deadline - Date.now()) : undefined;
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
		const statsOutput = await runResticCommand(
			statsArgs,
			resticEnv,
			undefined,
			undefined,
			undefined,
			undefined,
			{
				timeout: remainingTimeout(),
			}
		);
		const theStats = JSON.parse(statsOutput) as ResticRawStats;
		// console.log('statsOutput :', statsOutput);

		// Then get the backup ids from the active snapshots
		const snapRes = await runResticCommand(
			snapshotsArgs,
			resticEnv,
			undefined,
			undefined,
			undefined,
			undefined,
			{
				timeout: remainingTimeout(),
			}
		);
		const snapshots: ResticSnapshot[] = JSON.parse(snapRes);

		const snapshotBackupIds: string[] = [];
		snapshots.forEach(snap => {
			const backupIdTag = snap.tags.find(tag => tag.startsWith('backup-'));
			if (backupIdTag) {
				snapshotBackupIds.push(backupIdTag.replace('backup-', ''));
			}
		});

		return {
			total_size: theStats.total_size,
			snapshots: snapshotBackupIds,
		};
	} catch (error: any) {
		// Surface timeouts to the caller so the post-backup phase can log them
		if (error?.timedOut) {
			throw error;
		}
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

export function handleResticCheckResult(
	output: string,
	{ repo, device }: { repo: string; device: string }
): BackupVerifiedResult {
	let message = '';
	let hasError = true;
	let fix = '';
	let errorType = 'unknown';
	const logs: string[] = [];

	if (
		output.includes('The repository contains damaged pack files') ||
		(output.includes('pack') && output.includes('does not exist')) ||
		/id\s+[a-f0-9]+\s+not found in repository/i.test(output) ||
		output.includes('Pack ID does not match') ||
		output.includes('Blob ID does not match')
	) {
		errorType = 'pack_file_error';
		message = 'One or more pack files in the repository are damaged or missing.';
	}

	if (
		output.includes('The repository contains damaged pack files') &&
		output.includes('restic repair packs')
	) {
		errorType = 'repairable_pack_file_error';
		message = 'One or more pack files in the repository are damaged.';
	}

	if (output.includes('The repository index is damaged')) {
		errorType = 'index_error';
		message = 'The repository index is damaged.';
		fix = `Login to your Machine ${device}.
      Run this command:
      \`prestic repair index -r ${repo}\`
      When asked for the password, use the Pluton Encryption key.
      `;
	}

	if (output.includes('ciphertext verification failed')) {
		errorType = 'ciphertext_verification_error';
		message = 'Ciphertext verification failed.';
		fix =
			'Ciphertext verification issue is hard to fix. Please ask for help in the Restic forum or their IRC channel. These errors are often caused by hardware problems which must be investigated and fixed. Otherwise, the backup will be damaged again and again.';
	}
	if (output.includes('failed to authorize account')) {
		errorType = 'authorization_error';
		message = 'Storage Authorization failed.';
		hasError = false;
	}
	if (output.includes('no errors were found')) {
		errorType = '';
		message = 'No Issue Detected.';
		hasError = false;
	}

	output.split('\n').forEach((line: string) => {
		if (line.trim() !== '') {
			logs.push(line);
		}
	});

	return { message, logs, hasError, fix, errorType };
}
