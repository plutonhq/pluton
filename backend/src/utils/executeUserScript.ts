import { spawn, ChildProcess } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { PlanScript } from '../types/plans';
import { isLinuxInstalledRuntime, runRootHelper } from './linuxHelper';

/**
 * Executes a user-defined script file, capturing its output
 * and handling timeouts and errors gracefully.
 * Security: Only local file paths are accepted — no arbitrary commands.
 *
 * @param script The PlanScript object containing the scriptPath and options.
 * @returns A promise that resolves with the stdout and stderr of the script.
 * @throws An error if the script fails (non-zero exit code) or times out.
 */
export async function executeUserScript(
	script: PlanScript
): Promise<{ stdout: string; stderr: string }> {
	const { scriptPath, timeout } = script;
	validateScriptPath(scriptPath);

	if (script.runAsRoot && isLinuxInstalledRuntime()) {
		let stdout = '';
		let stderr = '';
		const scriptArgs = getScriptArgs(script);

		try {
			stdout = await runRootHelper('run-script', [scriptPath, ...scriptArgs], {
				timeoutMs: timeout ? timeout * 1000 : undefined,
				onStdout: data => {
					stdout += data.toString();
				},
				onStderr: data => {
					stderr += data.toString();
				},
			});
			return { stdout, stderr };
		} catch (error: any) {
			if (isSudoersAuthorizationError(error)) {
				throw new Error(
					`Root script requires an explicit sudoers rule for this script. Ask an administrator to grant NOPASSWD access for: /usr/bin/pluton-helper run-script ${scriptPath}`
				);
			}
			throw error;
		}
	}

	return new Promise((resolve, reject) => {
		// Determine how to execute based on file extension
		const { executable, args } = determineScriptExecution(scriptPath);

		let stdout = '';
		let stderr = '';

		const timeoutMs = timeout ? timeout * 1000 : undefined;

		const child: ChildProcess = spawn(executable, args, {
			timeout: timeoutMs,
			shell: false,
			cwd: path.dirname(scriptPath),
		});

		child.stdout?.on('data', data => {
			stdout += data.toString();
		});

		child.stderr?.on('data', data => {
			stderr += data.toString();
		});

		child.on('error', err => {
			reject(new Error(`Failed to start script process: ${err.message}`));
		});

		child.on('close', (code, signal) => {
			if (signal === 'SIGTERM') {
				reject(new Error(`Script timed out after ${timeout || 60}s.`));
				return;
			}
			if (code === 0) {
				resolve({ stdout, stderr });
			} else {
				const errorMessage = stderr.trim() || stdout.trim() || `Script exited with code ${code}`;
				reject(new Error(errorMessage));
			}
		});
	});
}

function isSudoersAuthorizationError(error: unknown): boolean {
	const candidate = error as { message?: string; stderr?: string };
	const text = `${candidate?.message || ''}\n${candidate?.stderr || ''}`;
	return (
		/\ba password is required\b/i.test(text) ||
		/\bno tty present and no askpass program specified\b/i.test(text) ||
		/\ba terminal is required\b/i.test(text) ||
		/\bis not in the sudoers file\b/i.test(text) ||
		/\bmay not run sudo\b/i.test(text) ||
		/\bnot allowed to execute\b/i.test(text) ||
		/\bsudoers\b/i.test(text)
	);
}

function validateScriptPath(scriptPath: string): void {
	if (!scriptPath || !scriptPath.trim()) {
		throw new Error('Script path is empty.');
	}

	if (scriptPath.includes('..')) {
		throw new Error('Script path contains ".." traversal sequences.');
	}

	if (!path.isAbsolute(scriptPath)) {
		throw new Error(`Script path must be absolute, got: ${scriptPath}`);
	}

	const stat = fs.statSync(scriptPath);
	if (stat.isDirectory()) {
		throw new Error(`Script path is a directory, not a file: ${scriptPath}`);
	}
}

function getScriptArgs(script: PlanScript): string[] {
	const candidate =
		(script as PlanScript & { args?: unknown; scriptArgs?: unknown }).args ??
		(script as PlanScript & { scriptArgs?: unknown }).scriptArgs;
	return Array.isArray(candidate) ? candidate.map(String) : [];
}

/**
 * Determines how to execute a script based on its file extension and the current OS.
 */
function determineScriptExecution(scriptPath: string): { executable: string; args: string[] } {
	const ext = path.extname(scriptPath).toLowerCase();

	switch (ext) {
		case '.ps1':
			return {
				executable: 'powershell.exe',
				args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
			};
		case '.bat':
		case '.cmd':
			return { executable: 'cmd.exe', args: ['/c', scriptPath] };
		case '.py':
			return {
				executable: os.platform() === 'win32' ? 'python' : 'python3',
				args: [scriptPath],
			};
		case '.rb':
			return { executable: 'ruby', args: [scriptPath] };
		case '.pl':
			return { executable: 'perl', args: [scriptPath] };
		case '.sh':
		case '.bash':
			if (os.platform() === 'win32') {
				return { executable: 'bash', args: [scriptPath] };
			}
			return { executable: '/bin/bash', args: [scriptPath] };
		case '.zsh':
			return { executable: 'zsh', args: [scriptPath] };
		default:
			if (os.platform() === 'win32') {
				return {
					executable: 'powershell.exe',
					args: ['-NoProfile', '-NonInteractive', '-File', scriptPath],
				};
			}
			return { executable: '/bin/sh', args: [scriptPath] };
	}
}

export async function runScriptsForEvent(
	eventName: string,
	scripts: PlanScript[],
	onStart: (scriptName: string) => Promise<void>,
	onComplete: (scriptName: string) => Promise<void>,
	onError: (scriptName: string, message: string) => Promise<void>
): Promise<void> {
	if (!scripts || !eventName) {
		console.log(`No scripts or event name provided for '${eventName}'`);
		return;
	}
	if (!scripts || scripts.length === 0) {
		return; // No scripts to run for this event
	}

	for (let i = 0; i < scripts.length; i++) {
		const script = scripts[i];
		// Skip if no script path is provided or script is disabled
		if (!script.scriptPath?.trim() || script.enabled === false) {
			continue;
		}
		const scriptActionName = eventName.toUpperCase() + '_SCRIPT_' + (i + 1);

		try {
			await onStart(scriptActionName);
			const { stdout, stderr } = await executeUserScript(script);
			console.log(`Executed script for '${eventName}': ${script.scriptPath}`);
			console.log('stdout :', stdout);
			console.log('stderr :', stderr);
			await onComplete(scriptActionName);
		} catch (error: any) {
			const errorMessage = `Script for '${eventName}' failed: "${script.scriptPath}". Error: ${error.message}`;
			console.log(errorMessage);
			await onError(scriptActionName, errorMessage);
			if (script.abortOnError) {
				throw new Error(`Critical 'beforeBackup' hook failed: ${error.message}`);
			}
		}
	}
}
