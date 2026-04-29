import { ChildProcess, spawn } from 'child_process';
import path from 'path';
import { constants } from 'fs';
import { access, stat } from 'fs/promises';
import { isBinaryMode, isDockerMode } from './installHelpers';

export const INSTALLED_HELPER_PATH = '/usr/bin/pluton-helper';

export type HelperCommandError = Error & {
	code?: number | null;
	stdout?: string;
	stderr?: string;
};

export type HelperRunOptions = {
	env?: Record<string, string>;
	cwd?: string;
	onStdout?: (data: Buffer) => void;
	onStderr?: (data: Buffer) => void;
	onComplete?: (code: number | null) => void;
	onProcess?: (process: ChildProcess) => void;
	timeoutMs?: number;
};

const helperDeniedTargets = new Set([
	'/',
	'/bin',
	'/boot',
	'/dev',
	'/etc',
	'/lib',
	'/lib64',
	'/proc',
	'/run',
	'/sbin',
	'/sys',
	'/usr',
]);

export function isLinuxInstalledRuntime(): boolean {
	return process.platform === 'linux' && isBinaryMode() && !isDockerMode();
}

export function getHelperPath(): string {
	if (!isLinuxInstalledRuntime() && process.env.PLUTON_HELPER_PATH) {
		return process.env.PLUTON_HELPER_PATH;
	}
	if (process.env.NODE_ENV === 'test' && process.env.PLUTON_HELPER_PATH) {
		return process.env.PLUTON_HELPER_PATH;
	}
	return INSTALLED_HELPER_PATH;
}

export function runHelper(
	subcommand: string,
	args: string[] = [],
	options: HelperRunOptions = {}
): Promise<string> {
	return runHelperProcess(getHelperPath(), [subcommand, ...args], options);
}

export function runRootHelper(
	subcommand: string,
	args: string[] = [],
	options: HelperRunOptions = {}
): Promise<string> {
	return runHelperProcess('sudo', ['-n', getHelperPath(), subcommand, ...args], options);
}

function runHelperProcess(
	command: string,
	args: string[],
	options: HelperRunOptions
): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: { ...process.env, ...options.env },
			timeout: options.timeoutMs,
		});

		options.onProcess?.(child);

		let stdout = '';
		let stderr = '';
		let settled = false;

		child.stdout?.on('data', (data: Buffer) => {
			stdout += data.toString();
			options.onStdout?.(data);
		});

		child.stderr?.on('data', (data: Buffer) => {
			stderr += data.toString();
			options.onStderr?.(data);
		});

		child.on('error', error => {
			settled = true;
			const helperError: HelperCommandError = new Error(
				`Failed to run pluton-helper: ${error.message}`
			);
			helperError.stdout = stdout.trim();
			helperError.stderr = stderr.trim();
			reject(helperError);
		});

		child.on('close', code => {
			if (settled) return;
			options.onComplete?.(code);
			if (code === 0) {
				resolve(stdout.trim());
				return;
			}

			const message = stderr.trim() || stdout.trim() || `pluton-helper failed with code ${code}`;
			const error: HelperCommandError = new Error(message);
			error.code = code;
			error.stdout = stdout.trim();
			error.stderr = stderr.trim();
			reject(error);
		});
	});
}

export function isPermissionDeniedError(error: unknown): boolean {
	const candidate = error as { code?: string | number; message?: string; stderr?: string };
	const text = `${candidate?.message || ''}\n${candidate?.stderr || ''}`;
	return (
		candidate?.code === 'EACCES' ||
		candidate?.code === 'EPERM' ||
		/\b(EACCES|EPERM)\b/i.test(text) ||
		/permission denied|operation not permitted/i.test(text)
	);
}

export function isHelperDeniedTarget(target: string, allowRootTarget: boolean = false): boolean {
	const normalized = normalizeLinuxPath(target);
	for (const deniedTarget of helperDeniedTargets) {
		if (deniedTarget === '/') {
			if (normalized === '/' && !allowRootTarget) return true;
			continue;
		}
		if (normalized === deniedTarget || normalized.startsWith(`${deniedTarget}/`)) {
			return true;
		}
	}
	return false;
}

export async function canWriteTargetOrParent(target: string): Promise<boolean> {
	const normalized = path.resolve(target);
	try {
		const targetStat = await stat(normalized);
		const writablePath = targetStat.isDirectory() ? normalized : path.dirname(normalized);
		await access(writablePath, constants.W_OK);
		return true;
	} catch (error: any) {
		if (error?.code !== 'ENOENT') {
			return false;
		}
	}

	try {
		await access(path.dirname(normalized), constants.W_OK);
		return true;
	} catch {
		return false;
	}
}

function normalizeLinuxPath(target: string): string {
	let normalized = path.posix.normalize(target.replace(/\\/g, '/'));
	if (!normalized.startsWith('/')) {
		normalized = path.posix.resolve('/', normalized);
	}
	return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized;
}
