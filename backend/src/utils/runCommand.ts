import { ChildProcess, spawn } from 'child_process';

/**
 * Runs a shell command asynchronously and returns its output as a Promise.
 * Allows streaming progress, error, completion, and process events via callbacks.
 *
 * @param args - Array of command and arguments (e.g., ['ls', '-la'])
 * @param env - Environment variables to set for the command
 * @param onProgress - Callback for stdout data events
 * @param onError - Callback for stderr data events
 * @param onComplete - Callback for process close event with exit code
 * @param onSpawn - Callback when the child process is spawned
 * @param stdin - Optional string to write to process stdin
 * @returns Promise that resolves with stdout output or rejects on error
 *
 * @example
 * runCommand(['echo', 'hello'], {},
 *   data => console.log('progress:', data.toString()),
 *   err => console.error('error:', err.toString()),
 *   code => console.log('exit code:', code)
 * ).then(output => console.log('output:', output));
 */
export const runCommand = (
	args: string[],
	env: Record<string, string> = {},
	onProgress?: (data: Buffer) => void,
	onError?: (data: Buffer) => void,
	onComplete?: (code: number) => void,
	onSpawn?: (process: ChildProcess) => void,
	stdin?: string
): Promise<string> => {
	return new Promise((resolve, reject) => {
		const command = args[0];
		const commandArgs = args.slice(1);

		const childProcess = spawn(command, commandArgs, {
			env: { ...process.env, ...env },
		});

		let output = '';

		if (onSpawn) onSpawn(childProcess);

		if (stdin && childProcess.stdin) {
			childProcess.stdin.write(stdin);
			childProcess.stdin.end();
		}

		childProcess.stdout.on('data', data => {
			output += data.toString();
			if (onProgress) onProgress(data);
		});

		childProcess.stderr.on('data', data => {
			if (onError) onError(data);
		});

		childProcess.on('close', code => {
			if (onComplete && code !== null) onComplete(code);
			if (code === 0) {
				resolve(output);
			} else if (code !== null) {
				reject(new Error(`Command failed with code ${code}`));
			} else {
				resolve(output);
			}
		});
	});
};
