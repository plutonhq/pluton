import { spawn, ChildProcess } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { PlanScript } from '../types/plans';

/**
 * Executes a user-defined script file, capturing its output
 * and handling timeouts and errors gracefully.
 * Security: Only local file paths are accepted — no arbitrary commands.
 *
 * @param script The PlanScript object containing the scriptPath and options.
 * @returns A promise that resolves with the stdout and stderr of the script.
 * @throws An error if the script fails (non-zero exit code) or times out.
 */
export function executeUserScript(script: PlanScript): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const { scriptPath, timeout } = script;

		if (!scriptPath || !scriptPath.trim()) {
			reject(new Error('Script path is empty.'));
			return;
		}

		// Validate path safety
		if (scriptPath.includes('..')) {
			reject(new Error('Script path contains ".." traversal sequences.'));
			return;
		}

		if (!path.isAbsolute(scriptPath)) {
			reject(new Error(`Script path must be absolute, got: ${scriptPath}`));
			return;
		}

		// Verify the file exists
		if (!fs.existsSync(scriptPath)) {
			reject(new Error(`Script file does not exist: ${scriptPath}`));
			return;
		}

		const stat = fs.statSync(scriptPath);
		if (stat.isDirectory()) {
			reject(new Error(`Script path is a directory, not a file: ${scriptPath}`));
			return;
		}

		// Determine how to execute based on file extension
		const { executable, args } = determineScriptExecution(scriptPath);

		let stdout = '';
		let stderr = '';

		const child: ChildProcess = spawn(executable, args, {
			timeout: timeout || undefined,
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
				reject(new Error(`Script timed out after ${timeout || 60000}ms.`));
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
