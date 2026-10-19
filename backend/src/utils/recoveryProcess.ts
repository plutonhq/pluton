import { spawn } from 'child_process';
import type { Readable } from 'stream';
import type { RecoveryStage } from '../types/recoveryTests';
import { checkRecoveryCancellation, RecoveryTestError } from './recoveryValidation';
import { killProcessTree } from './processTree';
import crypto from 'crypto';
import { processManager } from '../managers/ProcessManager';

export type RecoveryProcessInput = {
	binary: string;
	args: string[];
	cwd: string;
	env: NodeJS.ProcessEnv;
	signal: AbortSignal;
	stage: RecoveryStage;
	timeoutMs: number;
	input?: string | Readable;
	capture?: boolean;
};
/** Provider output is classified locally, never attached to errors, logs or results. */
export async function runRecoveryProcess(input: RecoveryProcessInput): Promise<string> {
	checkRecoveryCancellation(input.signal);
	return new Promise((resolve, reject) => {
		const child = spawn(input.binary, input.args, {
			shell: false,
			detached: process.platform !== 'win32',
			windowsHide: true,
			cwd: input.cwd,
			env: input.env,
			stdio: ['pipe', 'pipe', 'pipe'],
		});
		const processId = `recovery-db-${crypto.randomBytes(12).toString('hex')}`;
		processManager.trackProcess(processId, child);
		let output = '',
			stderr = '',
			stdoutBytes = 0,
			stderrBytes = 0;
		let inputInterrupted = false;
		let failure: RecoveryTestError | undefined;
		const stop = (error: RecoveryTestError) => {
			failure ||= error;
			killProcessTree(child, 'SIGKILL');
		};
		const abort = () => stop(new RecoveryTestError(input.stage, 'cancelled'));
		input.signal.addEventListener('abort', abort, { once: true });
		const timer = setTimeout(
			() => stop(new RecoveryTestError(input.stage, 'database-import-timeout')),
			input.timeoutMs
		);
		child.once('error', (error: NodeJS.ErrnoException) => stop(new RecoveryTestError(input.stage,
			error.code === 'ENOMEM' ? 'database-out-of-memory' : 'database-client-missing')));
		child.stdout.on('data', (chunk: Buffer) => {
			stdoutBytes += chunk.length;
			if (stdoutBytes > 64 * 1024)
				stop(new RecoveryTestError(input.stage, 'database-output-limit'));
			else if (input.capture) output += chunk.toString('utf8');
		});
		child.stderr.on('data', (chunk: Buffer) => {
			stderrBytes += chunk.length;
			if (stderrBytes > 64 * 1024)
				stop(new RecoveryTestError(input.stage, 'database-output-limit'));
			else stderr += chunk.toString('utf8');
		});
		let writing: Promise<void>;
		const inputError = (error: NodeJS.ErrnoException) => {
			inputInterrupted = true;
			// Preserve native auth/SQL errors for clients that reject the input.
			// A zero exit must still fail if any input was not delivered.
			if (error.code !== 'EPIPE' && error.code !== 'ERR_STREAM_PREMATURE_CLOSE')
				stop(new RecoveryTestError(input.stage, 'database-import-failed'));
		};
		child.stdin.on('error', inputError);
		if (typeof input.input === 'object') {
			const source = input.input;
			writing = new Promise<void>(resolve => {
				// Native pipe supplies bounded backpressure. Remove our completion
				// listeners on every path, including source read failure/client exit.
				const done = () => {
					source.off('error', broken);
					source.off('close', sourceClosed);
					child.stdin.off('finish', done);
					child.stdin.off('close', destinationClosed);
					resolve();
				};
				const broken = (error: NodeJS.ErrnoException) => {
					inputError(error);
					source.unpipe(child.stdin);
					source.destroy();
					child.stdin.destroy();
					done();
				};
				const sourceClosed = () => {
					if (!source.readableEnded)
						broken(Object.assign(new Error(), { code: 'ERR_STREAM_PREMATURE_CLOSE' }));
				};
				const destinationClosed = () => {
					if (!child.stdin.writableFinished) broken(Object.assign(new Error(), { code: 'EPIPE' }));
					else done();
				};
				source.once('error', broken);
				source.once('close', sourceClosed);
				child.stdin.once('finish', done);
				child.stdin.once('close', destinationClosed);
				source.pipe(child.stdin);
			});
		} else {
			child.stdin.end(input.input);
			writing = Promise.resolve();
		}
		child.once('close', code => {
			// A client can exit before consuming its full input. Close the source
			// stream as well as the process tree; do not leave a read/pipeline alive.
			if (typeof input.input === 'object' && !input.input.readableEnded) {
				inputInterrupted = true;
				input.input.destroy();
			}
			child.stdin.destroy();
			processManager.untrackProcess(processId);
			clearTimeout(timer);
			input.signal.removeEventListener('abort', abort);
			if (process.platform !== 'win32' && child.pid) {
				try {
					process.kill(-child.pid, 'SIGKILL');
				} catch {
					/* Already stopped. */
				}
			}
			void writing.then(() => {
				if (failure) reject(failure);
				else if (code !== 0)
					reject(
						new RecoveryTestError(
							input.stage,
							/(?:ENOSPC|No space left on device|Disk is full|\bERROR\s+(?:1021|1114)\b)/i.test(stderr)
								? 'database-storage-full'
								: /(?:out of memory|cannot allocate memory|memory allocation fail|\bERROR\s+(?:1037|1038|1041)\b)/i.test(stderr)
									? 'database-out-of-memory'
									: /(?:\b1045\b|Access denied|password authentication failed|no password supplied|no pg_hba.conf entry)/i.test(
								stderr
							)
								? 'database-authentication-failed'
								: /(?:\bERROR\s+2026\b|TLS\/SSL error|certificate verify|certificate verification|server certificate|root certificate|server does not support SSL)/i.test(
											stderr
									  )
									? 'database-tls-failed'
									: /(?:\b200[2356]\b|Can't connect|connection refused|could not translate host name|connection timed out|network is unreachable)/i.test(
												stderr
										  )
										? 'database-target-unavailable'
										: /role .* does not exist/i.test(stderr)
											? 'database-role-missing'
											: 'database-import-failed'
						)
					);
				else if (inputInterrupted)
					reject(new RecoveryTestError(input.stage, 'database-import-failed'));
				else resolve(output);
			});
		});
		if (input.signal.aborted) abort();
	});
}
