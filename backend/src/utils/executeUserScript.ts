import Cryptr from 'cryptr';
import { spawn, ChildProcess } from 'child_process';
import os from 'os';
import { PlanScript } from '../types/plans';

/**
 * Executes a user-defined script in a specified shell, capturing its output
 * and handling timeouts and errors gracefully.
 *
 * @param script The PlanScript object containing the command and options.
 * @returns A promise that resolves with the stdout and stderr of the command.
 * @throws An error if the command fails (non-zero exit code) or times out.
 */
export function executeUserScript(script: PlanScript): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const { command, shell, timeout } = script;

		let executable: string;
		let args: string[];

		// Determine the correct executable and arguments based on the chosen shell
		switch (shell) {
			case 'powershell':
				executable = 'powershell.exe';
				// Using -Command is robust for complex commands. -NoProfile speeds up startup.
				args = ['-NoProfile', '-NonInteractive', '-Command', command];
				break;
			case 'cmd':
				executable = 'cmd.exe';
				args = ['/c', command];
				break;
			case 'bash':
				executable = 'bash';
				args = ['-c', command];
				break;
			case '/bin/bash':
				executable = '/bin/bash';
				args = ['-c', command];
				break;
			case 'zsh':
				executable = 'zsh';
				args = ['-c', command];
				break;
			case '/bin/sh':
			default: // Default to the most basic, universally available shell
				executable = '/bin/sh';
				args = ['-c', command];
				break;
		}

		// On Windows, if a Unix-style shell is requested, but the executable is cmd.exe, adjust.
		// This handles the 'default' case on Windows more gracefully.
		if (os.platform() === 'win32' && shell === 'default') {
			executable = 'powershell.exe';
			args = ['-NoProfile', '-NonInteractive', '-Command', command];
		}

		let stdout = '';
		let stderr = '';

		const child: ChildProcess = spawn(executable, args, {
			timeout: timeout || undefined, // Default to a 60-second timeout
			// 'shell: false' is important for security and predictability,
			// as we are already explicitly invoking the desired shell.
			shell: false,
		});

		child.stdout?.on('data', data => {
			stdout += data.toString();
		});

		child.stderr?.on('data', data => {
			stderr += data.toString();
		});

		// Handle timeout and other spawn errors
		child.on('error', err => {
			reject(new Error(`Failed to start script process: ${err.message}`));
		});

		child.on('close', (code, signal) => {
			if (signal === 'SIGTERM') {
				// This indicates the process was killed due to timeout
				reject(new Error(`Script timed out after ${timeout || 60000}ms.`));
				return;
			}
			if (code === 0) {
				// Success
				resolve({ stdout, stderr });
			} else {
				// Failure
				const errorMessage = stderr.trim() || stdout.trim() || `Script exited with code ${code}`;
				reject(new Error(errorMessage));
			}
		});
	});
}

export async function runScriptsForEvent(
	eventName: string,
	scripts: PlanScript[],
	secret: string,
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

	// get index from this for loop

	for (let i = 0; i < scripts.length; i++) {
		const script = scripts[i];
		// Skip if no command is provided or script is disabled
		if (!script.command.trim() || script.enabled === false) {
			continue;
		}
		const scriptActionName = eventName.toUpperCase() + '_SCRIPT_' + (i + 1);

		try {
			if (script.type === 'command' && script.command) {
				// await updateProgress(planId, backupId, phase, scriptActionName + '_START', false);
				onStart(scriptActionName);
				const cryptr = new Cryptr(secret);
				const decryptedCommand = cryptr.decrypt(script.command);
				const { stdout, stderr } = await executeUserScript({
					...script,
					command: decryptedCommand,
				});
				console.log(`Executed script for '${eventName}': ${script.command}`);
				console.log('stdout :', stdout);
				console.log('stderr :', stderr);
				if (script.logOutput) {
					// if(stdout) planLogger('script', options.id).info(`Script stdout: ${stdout}`);
					// if(stderr) planLogger('script', options.id).warn(`Script stderr: ${stderr}`);
				}
				await onComplete(scriptActionName);
			}
		} catch (error: any) {
			const errorMessage = `Script for '${eventName}' failed: "${script.command}". Error: ${error.message}`;
			console.log(errorMessage);
			await onError(scriptActionName, errorMessage);
			if (script.abortOnError) {
				// This throw will be caught by the CORE execute() method's main try/catch block.
				throw new Error(`Critical 'beforeBackup' hook failed: ${error.message}`);
			}
		}
	}
}
