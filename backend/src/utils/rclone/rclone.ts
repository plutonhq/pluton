import { spawn, ChildProcess } from 'child_process';
import os from 'os';
import { getBinaryPath } from '../binaryPathResolver';
import { getRcloneConfigPath } from './helpers';
import { configService } from '../../services/ConfigService';
import { buildRcloneEnvFromSettings } from '../globalSettings';
import {
	protectedStorageEnvironment,
	trustEnvironment,
	redactStorageOutput,
} from '../storageSecurity';

export interface RunRcloneOptions {
	timeoutMs?: number;
}

export function runRcloneCommand(
	args: string[],
	env?: Record<string, string>,
	opts?: RunRcloneOptions
): Promise<string> {
	return new Promise((resolve, reject) => {
		const rcloneBinary = getBinaryPath('rclone');
		const rcloneConfigPath = getRcloneConfigPath();
		const localAppData = process.env.LOCALAPPDATA || os.homedir();
		// Inject global rclone settings from data/config/rclone_global.json
		const globalRcloneEnv = buildRcloneEnvFromSettings();

		const envVars = {
			...protectedStorageEnvironment(args),
			PATH: process.env.PATH, // Needed for docker instances
			RCLONE_CONFIG: rcloneConfigPath,
			LOCALAPPDATA: localAppData,
			RCLONE_CONFIG_PASS: configService.config.ENCRYPTION_KEY,
			...globalRcloneEnv,
			...env, // Per-call overrides still take precedence
			...trustEnvironment(),
		};
		// console.log('rcloneBinary :', rcloneBinary, args);
		const rcProcess = spawn(rcloneBinary, args, {
			env: envVars,
			detached: process.platform !== 'win32',
		});
		let output = '';
		let errorOutput = '';
		let timer: NodeJS.Timeout | undefined;
		let settled = false;

		const settle = (fn: () => void) => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			fn();
		};

		if (opts?.timeoutMs) {
			rcProcess.on('error', (error: Error) => settle(() => reject(error)));
			timer = setTimeout(() => {
				rcProcess.kill();
				settle(() =>
					reject(new Error(`Rclone command timed out after ${opts.timeoutMs}ms: ${args[0]}`))
				);
			}, opts.timeoutMs);
		}

		rcProcess.stdout?.on('data', (data: Buffer) => {
			// console.log('[rclone] Data :', data.toString());
			// stdout may be exact restored file bytes (rclone cat), not a diagnostic.
			output += data.toString();
		});

		rcProcess.stderr?.on('data', (data: Buffer) => {
			// console.log('[rclone] Error :', data.toString());
			errorOutput += data.toString();
		});

		rcProcess.on('close', (code: number) => {
			settle(() => {
				if (code === 0) {
					const outputRes = output.trim();
					const errorOutputRes = redactStorageOutput(errorOutput.trim(), envVars);
					if (outputRes) {
						resolve(outputRes);
					} else if (errorOutputRes) {
						resolve(errorOutputRes);
					} else {
						resolve('');
					}
				} else {
					reject(new Error(redactStorageOutput(errorOutput, envVars) || `Rclone command failed`));
				}
			});
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
		...protectedStorageEnvironment(args),
		PATH: process.env.PATH,
		RCLONE_CONFIG: rcloneConfigPath,
		LOCALAPPDATA: localAppData,
		RCLONE_CONFIG_PASS: configService.config.ENCRYPTION_KEY,
		...globalRcloneEnv,
		...options?.env,
		...trustEnvironment(),
	};

	const rcProcess = spawn(rcloneBinary, args, {
		env: envVars,
		detached: process.platform !== 'win32',
	});
	let output = '';
	let errorOutput = '';
	let diagnosticTail = '';
	const reportDiagnostics = (final = false) => {
		const lines = diagnosticTail.split('\n');
		diagnosticTail = final ? '' : lines.pop() || '';
		const complete = lines.join('\n');
		if (complete) options?.onStderr?.(redactStorageOutput(complete + (final ? '' : '\n'), envVars));
	};

	const promise = new Promise<string>((resolve, reject) => {
		rcProcess.stdout?.on('data', (data: Buffer) => {
			output += data.toString();
		});

		rcProcess.stderr?.on('data', (data: Buffer) => {
			const chunk = data.toString();
			errorOutput += chunk;
			diagnosticTail += chunk;
			reportDiagnostics();
		});

		rcProcess.on('close', (code: number) => {
			reportDiagnostics(true);
			if (code === 0) {
				const outputRes = output.trim();
				const errorOutputRes = redactStorageOutput(errorOutput.trim(), envVars);
				if (outputRes) {
					resolve(outputRes);
				} else if (errorOutputRes) {
					resolve(errorOutputRes);
				} else {
					resolve('');
				}
			} else {
				reject(new Error(redactStorageOutput(errorOutput, envVars) || `Rclone command failed`));
			}
		});
	});

	return { process: rcProcess, promise };
}
