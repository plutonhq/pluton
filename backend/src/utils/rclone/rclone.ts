import { spawn, ChildProcess } from 'child_process';
import os from 'os';
import { getBinaryPath } from '../binaryPathResolver';
import { getRcloneConfigPath } from './helpers';
import { configService } from '../../services/ConfigService';
import { buildRcloneEnvFromSettings } from '../globalSettings';

export function runRcloneCommand(args: string[], env?: Record<string, string>): Promise<string> {
	return new Promise((resolve, reject) => {
		const rcloneBinary = getBinaryPath('rclone');
		const rcloneConfigPath = getRcloneConfigPath();
		const localAppData = process.env.LOCALAPPDATA || os.homedir();
		// Inject global rclone settings from data/config/rclone_global.json
		const globalRcloneEnv = buildRcloneEnvFromSettings();

		const envVars = {
			PATH: process.env.PATH, // Needed for docker instances
			RCLONE_CONFIG: rcloneConfigPath,
			LOCALAPPDATA: localAppData,
			RCLONE_CONFIG_PASS: configService.config.ENCRYPTION_KEY,
			...globalRcloneEnv,
			...env, // Per-call overrides still take precedence
		};
		// console.log('rcloneBinary :', rcloneBinary, args);
		const rcProcess = spawn(rcloneBinary, args, { env: envVars });
		let output = '';
		let errorOutput = '';

		rcProcess.stdout?.on('data', (data: Buffer) => {
			// console.log('[rclone] Data :', data.toString());
			output += data.toString();
		});

		rcProcess.stderr?.on('data', (data: Buffer) => {
			// console.log('[rclone] Error :', data.toString());
			errorOutput += data.toString();
		});

		rcProcess.on('close', (code: number) => {
			if (code === 0) {
				const outputRes = output.trim();
				const errorOutputRes = errorOutput.trim();
				if (outputRes) {
					resolve(outputRes);
				} else if (errorOutputRes) {
					resolve(errorOutputRes);
				} else {
					resolve('');
				}
			} else {
				reject(new Error(errorOutput || `Rclone command failed`));
			}
		});
	});
}

/**
 * Spawns an rclone process and returns both the ChildProcess (for tracking/cancellation)
 * and a promise that resolves with the full output on completion.
 * The optional `onStderr` callback is called for each chunk of stderr data,
 * enabling real-time progress parsing.
 */
export function runRcloneCommandWithProgress(
	args: string[],
	options?: { onStderr?: (chunk: string) => void; env?: Record<string, string> }
): { process: ChildProcess; promise: Promise<string> } {
	const rcloneBinary = getBinaryPath('rclone');
	const rcloneConfigPath = getRcloneConfigPath();
	const localAppData = process.env.LOCALAPPDATA || os.homedir();
	const globalRcloneEnv = buildRcloneEnvFromSettings();

	const envVars = {
		PATH: process.env.PATH,
		RCLONE_CONFIG: rcloneConfigPath,
		LOCALAPPDATA: localAppData,
		RCLONE_CONFIG_PASS: configService.config.ENCRYPTION_KEY,
		...globalRcloneEnv,
		...options?.env,
	};

	const rcProcess = spawn(rcloneBinary, args, { env: envVars });
	let output = '';
	let errorOutput = '';

	const promise = new Promise<string>((resolve, reject) => {
		rcProcess.stdout?.on('data', (data: Buffer) => {
			output += data.toString();
		});

		rcProcess.stderr?.on('data', (data: Buffer) => {
			const chunk = data.toString();
			errorOutput += chunk;
			options?.onStderr?.(chunk);
		});

		rcProcess.on('close', (code: number) => {
			if (code === 0) {
				const outputRes = output.trim();
				const errorOutputRes = errorOutput.trim();
				if (outputRes) {
					resolve(outputRes);
				} else if (errorOutputRes) {
					resolve(errorOutputRes);
				} else {
					resolve('');
				}
			} else {
				reject(new Error(errorOutput || `Rclone command failed`));
			}
		});
	});

	return { process: rcProcess, promise };
}
