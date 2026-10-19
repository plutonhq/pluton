import { spawn, type ChildProcess } from 'child_process';
import { StringDecoder } from 'string_decoder';
import { z } from 'zod';
import { processManager } from '../../managers/ProcessManager';
import { getBinaryPath } from '../binaryPathResolver';

const RESTORE_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_RESTORE_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_RESTORE_LINE_LENGTH = 128 * 1024;

export type LegacyRestoreExecutionFailure =
	| 'wrong-password'
	| 'repository-unavailable'
	| 'timeout'
	| 'output-limit'
	| 'cancelled'
	| 'execution-failed';

export class LegacyRepositoryRestoreError extends Error {
	constructor(public readonly kind: LegacyRestoreExecutionFailure) {
		super('Legacy repository restore failed.');
		Object.setPrototypeOf(this, LegacyRepositoryRestoreError.prototype);
	}
}

export type LegacyRestoreExecutionRequest = {
	jobId: string;
	repositoryPath: string;
	password: string;
	snapshotId: string;
	selectedPaths: string[];
	stagingPath: string;
};

export type LegacyRestoreExecutionResult = {
	restoredFileCount: number | null;
	restoredBytes: number | null;
};

export interface LegacyResticRestoreClient {
	restoreSnapshot(request: LegacyRestoreExecutionRequest): Promise<LegacyRestoreExecutionResult>;
	cancel(jobId: string): boolean;
}

const restoreSummarySchema = z.object({
	message_type: z.literal('summary'),
	files_restored: z.number().int().nonnegative().optional(),
	bytes_restored: z.number().nonnegative().optional(),
});

/**
 * Purpose-built Restic restore runner for legacy repositories. It exposes one
 * fixed repository-read/staging-write operation; callers cannot supply a
 * command name, arbitrary Restic flags, or a host destination.
 */
export class ResticLegacyRepositoryRestoreExecutor implements LegacyResticRestoreClient {
	private readonly running = new Map<string, ChildProcess>();
	private readonly cancelled = new Set<string>();

	async restoreSnapshot(request: LegacyRestoreExecutionRequest): Promise<LegacyRestoreExecutionResult> {
		// Cancellation can win after the service marks a job running but before
		// spawn() registers its child. Consume that request before constructing a
		// process so a cancelled job never starts Restic.
		if (this.cancelled.delete(request.jobId)) {
			throw new LegacyRepositoryRestoreError('cancelled');
		}

		const args = [
			'--no-lock',
			'--no-cache',
			'--json',
			'--repo',
			request.repositoryPath,
			'restore',
			request.snapshotId,
			'--target',
			request.stagingPath,
			'--overwrite',
			'never',
			...request.selectedPaths.flatMap(selectedPath => ['--include', `/${selectedPath}`]),
		];
		const environment = { ...process.env };
		delete environment.RESTIC_REPOSITORY;
		delete environment.RESTIC_REPOSITORY_FILE;
		delete environment.RESTIC_PASSWORD_COMMAND;
		delete environment.RESTIC_PASSWORD_FILE;
		environment.RESTIC_PASSWORD = request.password;

		return await new Promise<LegacyRestoreExecutionResult>((resolve, reject) => {
			let settled = false;
			let outputBytes = 0;
			let lineBuffer = '';
			let restoredFileCount: number | null = null;
			let restoredBytes: number | null = null;
			const decoder = new StringDecoder('utf8');
			const processId = `legacy-restore-${request.jobId}`;
			const child = spawn(getBinaryPath('restic'), args, {
				env: environment,
				shell: false,
				windowsHide: true,
				stdio: ['ignore', 'pipe', 'pipe'],
			});
			this.running.set(request.jobId, child);
			processManager.trackProcess(processId, child);

			const timeout = setTimeout(() => {
				this.cancelled.delete(request.jobId);
				try {
					child.kill('SIGKILL');
				} catch {
					// The child may already have exited.
				}
				settle(() => reject(new LegacyRepositoryRestoreError('timeout')));
			}, RESTORE_TIMEOUT_MS);

			const settle = (callback: () => void) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				this.running.delete(request.jobId);
				this.cancelled.delete(request.jobId);
				processManager.untrackProcess(processId);
				callback();
			};

			const parseLine = (line: string) => {
				if (!line || line.length > MAX_RESTORE_LINE_LENGTH) return;
				try {
					const parsed = restoreSummarySchema.safeParse(JSON.parse(line));
					if (parsed.success) {
						restoredFileCount = parsed.data.files_restored ?? null;
						restoredBytes = parsed.data.bytes_restored ?? null;
					}
				} catch {
					// Discard non-JSON output. It can contain repository details.
				}
			};

			child.on('error', () => {
				settle(() => reject(new LegacyRepositoryRestoreError('execution-failed')));
			});

			child.stdout?.on('data', (chunk: Buffer) => {
				if (settled) return;
				outputBytes += chunk.length;
				if (outputBytes > MAX_RESTORE_OUTPUT_BYTES) {
					try {
						child.kill('SIGKILL');
					} catch {
						// The child may already have exited.
					}
					settle(() => reject(new LegacyRepositoryRestoreError('output-limit')));
					return;
				}
				lineBuffer += decoder.write(chunk);
				const lines = lineBuffer.split(/\r?\n/);
				lineBuffer = lines.pop() || '';
				for (const line of lines) parseLine(line);
			});

			// Drain stderr without retaining, logging, or returning it. Restic and
			// transport errors can expose repository locations or credentials.
			child.stderr?.on('data', () => undefined);

			child.on('close', code => {
				if (settled) return;
				parseLine(lineBuffer + decoder.end());
				if (this.cancelled.has(request.jobId)) {
					settle(() => reject(new LegacyRepositoryRestoreError('cancelled')));
					return;
				}
				if (code === 0) {
					settle(() => resolve({ restoredFileCount, restoredBytes }));
					return;
				}
				if (code === 12) {
					settle(() => reject(new LegacyRepositoryRestoreError('wrong-password')));
					return;
				}
				if (code === 10) {
					settle(() => reject(new LegacyRepositoryRestoreError('repository-unavailable')));
					return;
				}
				settle(() => reject(new LegacyRepositoryRestoreError('execution-failed')));
			});
		});
	}

	cancel(jobId: string): boolean {
		this.cancelled.add(jobId);
		const child = this.running.get(jobId);
		if (!child) return false;
		try {
			child.kill('SIGTERM');
		} catch {
			return false;
		}
		return true;
	}
}
