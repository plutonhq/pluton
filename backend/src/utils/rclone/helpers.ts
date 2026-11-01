import { ChildProcess } from 'child_process';
import path from 'path';
import os from 'os';
import { appPaths } from '../AppPaths';
import { runRcloneCommand, RunRcloneOptions } from './rclone';
import { runCommand } from '../runCommand';
import { getBinaryPath } from '../binaryPathResolver';
import { getInstallType } from '../installHelpers';

// A flag or a connection string can make rclone run a command, such as
// :sftp,ssh="cmd": or remote,ssh="cmd":.
const RCLONE_UNSAFE_PATH = /^(-|:|[^/\\:,]*,)/;

/** True for a local path or remote:path. */
export function isSafeRclonePath(value: string) {
	return !RCLONE_UNSAFE_PATH.test(value);
}

export interface RcloneAuthSession {
	id: string;
	storageType: string;
	status: 'pending' | 'success' | 'error';
	token?: string;
	error?: string;
	authUrl?: string;
	process?: ChildProcess;
	startedAt: number;
}

export interface RcloneAuthSessionStatus {
	status: 'pending' | 'success' | 'error';
	token?: string;
	error?: string;
	authUrl?: string;
}

export const getRcloneConfigPath = (secure = false) => {
	const fileName = secure ? 'rclone.conf.enc' : 'rclone.conf';
	const rcloneConfPath = path.join(appPaths.getConfigDir(), fileName);
	return rcloneConfPath;
};

export interface RcloneLsJsonItem {
	Path: string;
	Name: string;
	Size: number;
	MimeType?: string;
	ModTime?: string;
	IsDir: boolean;
}

/**
 * Copy a single file to an exact destination path (not into a directory).
 */
export async function rcloneCopyTo(
	src: string,
	dest: string,
	env?: Record<string, string>,
	opts?: RunRcloneOptions
): Promise<void> {
	await runRcloneCommand(['copyto', src, dest], env, opts);
}

export async function rcloneDeleteFile(
	target: string,
	env?: Record<string, string>,
	opts?: RunRcloneOptions
): Promise<void> {
	await runRcloneCommand(['deletefile', target], env, opts);
}

/**
 * Rclone reports failures as timestamped log lines. This returns just the message
 * of the first ERROR line, so the UI shows a user-friendly error message.
 */
export function rcloneErrorMessage(error: any): string {
	const raw = (error?.message || '').trim();
	if (!raw) return '';
	const lines: string[] = raw
		.split('\n')
		.map((line: string) => line.trim())
		.filter(Boolean);
	const line = lines.find((l: string) => /\s(ERROR|CRITICAL)\s*:/.test(l)) || lines[0];
	return line.replace(/^.*?\s(?:ERROR|CRITICAL|NOTICE|INFO)\s*:\s*/, '').trim() || raw;
}

/**
 * List a remote path as JSON.
 */
export async function rcloneLsJson(
	target: string,
	env?: Record<string, string>,
	opts?: RunRcloneOptions
): Promise<RcloneLsJsonItem[]> {
	const raw = await runRcloneCommand(['lsjson', target], env, opts);
	if (!raw || !raw.trimStart().startsWith('[')) {
		return [];
	}
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? (parsed as RcloneLsJsonItem[]) : [];
	} catch {
		return [];
	}
}

export async function encryptRcloneConfig(
	password: string
): Promise<{ success: boolean; result: string }> {
	try {
		await runRcloneCommand(['config', 'encryption', 'check']);
		return {
			success: true,
			result: 'Encryption already completed. Skipped.',
		};
	} catch (error: any) {
		console.log('[Security Error]Rclone Config File Not encrypted. Starting Encryption...');
		const envVarName = `RCLONE_TEMP_PASS_${Date.now()}`;
		try {
			const passwordCommand =
				os.platform() === 'win32' ? `cmd /c "echo %${envVarName}%"` : `/bin/echo $${envVarName}`;

			const res = await runRcloneCommand(
				['config', 'encryption', 'set', '--password-command', passwordCommand],
				{
					[envVarName]: password,
				}
			);

			if (res.includes('failed')) {
				throw new Error(res);
			}
			console.log('[encryptRcloneConfig] success :', res);
			return {
				success: true,
				result: res,
			};
		} catch (error: any) {
			console.log('[encryptRcloneConfig] error :', error);
			return {
				success: false,
				result: error?.message || '',
			};
		} finally {
			delete process.env[envVarName];
		}
	}
}

/**
 * Spawns `rclone authorize <storageType>` in the background.
 * Updates the provided AuthSession object in-place as stdout/stderr arrive.
 * On desktop installs the browser opens automatically;
 * on docker/server installs `--auth-no-open-browser` is added.
 */
export function spawnRcloneAuthorize(session: RcloneAuthSession, timeoutMs: number): void {
	const rcloneBinary = getBinaryPath('rclone');
	const installType = getInstallType();
	const args = [rcloneBinary, 'authorize', session.storageType];

	// For docker/server installs, don't try to open browser
	if (installType === 'docker' || installType === 'server') {
		args.push('--auth-no-open-browser');
	}

	let output = '';
	let errorOutput = '';

	// Set up auto-timeout
	const timeout = setTimeout(() => {
		if (session.process && !session.process.killed) {
			session.process.kill();
		}
		if (session.status === 'pending') {
			session.status = 'error';
			session.error = 'Authorization timed out after 5 minutes';
		}
	}, timeoutMs);

	const extractToken = (text: string): string | null => {
		const tokenMatch = text.match(/-+>\s*([\s\S]*?)\s*<-+/);
		if (tokenMatch && tokenMatch[1]) {
			const tokenJson = tokenMatch[1].trim();
			try {
				JSON.parse(tokenJson);
				return tokenJson;
			} catch {
				return null;
			}
		}
		return null;
	};

	runCommand(
		args,
		{},
		// onProgress (stdout)
		(data: Buffer) => {
			output += data.toString();
			console.log('[oauth] stdout:', data.toString());

			const token = extractToken(output);
			if (token) {
				session.status = 'success';
				session.token = token;
			}
		},
		// onError (stderr)
		(data: Buffer) => {
			const chunk = data.toString();
			errorOutput += chunk;
			console.log('[oauth] stderr:', chunk);

			// Extract auth URL from stderr (rclone prints it there)
			const urlMatch = chunk.match(/https?:\/\/127\.0\.0\.1:\d+\/auth\S*/);
			if (urlMatch && !session.authUrl) {
				session.authUrl = urlMatch[0];
			}
		},
		// onComplete (exit code)
		(code: number) => {
			clearTimeout(timeout);
			if (session.status === 'pending') {
				const token = extractToken(output);
				if (token) {
					session.status = 'success';
					session.token = token;
					return;
				}
				session.status = 'error';
				session.error = `rclone authorize exited with code ${code}`;
			}
		},
		// onSpawn (capture process ref)
		childProcess => {
			session.process = childProcess;
		}
	).catch(err => {
		clearTimeout(timeout);
		// runCommand rejects on non-zero exit, but token may already be extracted
		if (session.status === 'pending') {
			const token = extractToken(output);
			if (token) {
				session.status = 'success';
				session.token = token;
				return;
			}
			session.status = 'error';
			session.error = err?.message || 'Authorization failed';
		}
	});
}
