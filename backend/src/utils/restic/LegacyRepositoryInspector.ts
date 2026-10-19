import { spawn } from 'child_process';
import path from 'path';
import { z } from 'zod';
import { getBinaryPath } from '../binaryPathResolver';
import {
	getLegacySnapshotParent,
	normalizeLegacySnapshotPath,
	toResticSnapshotPath,
} from '../legacySnapshotPath';
import type {
	LegacyRepositorySnapshot,
	LegacyRepositoryStats,
	LegacySnapshotDirectory,
	LegacySnapshotEntry,
} from '../../types/legacyRepositories';

const INSPECTION_TIMEOUT_MS = 30_000;
const MAX_INSPECTION_OUTPUT_BYTES = 8 * 1024 * 1024;
const ALLOWED_INSPECTION_OPERATIONS = new Set(['snapshots', 'stats', 'ls']);
const MAX_SNAPSHOT_DIRECTORY_ENTRIES = 10_000;

export type LegacyRepositoryInspectionOperation = 'snapshots' | 'stats' | 'ls';

export type LegacyRepositoryInspectionFailure =
	| 'forbidden-operation'
	| 'wrong-password'
	| 'repository-unavailable'
	| 'timeout'
	| 'invalid-output'
	| 'snapshot-path-not-found'
	| 'output-limit'
	| 'execution-failed';

/**
 * Deliberately contains no subprocess output. Restic and transport errors can
 * contain repository locations or backend details and are unsafe to return or log.
 */
export class LegacyRepositoryInspectionError extends Error {
	constructor(public readonly kind: LegacyRepositoryInspectionFailure) {
		super('Legacy repository inspection failed.');
		Object.setPrototypeOf(this, LegacyRepositoryInspectionError.prototype);
	}
}

export interface LegacyResticInspectionClient {
	listSnapshots(repositoryPath: string, password: string): Promise<LegacyRepositorySnapshot[]>;
	getRepositoryStats(repositoryPath: string, password: string): Promise<LegacyRepositoryStats>;
	listSnapshotDirectory(
		repositoryPath: string,
		password: string,
		snapshotId: string,
		relativePath: string
	): Promise<LegacySnapshotDirectory>;
}

const snapshotSchema = z.object({
	id: z.string().regex(/^[a-fA-F0-9]{64}$/),
	time: z.string().min(1),
	hostname: z.string().default(''),
	tags: z.array(z.string()).default([]),
	paths: z.array(z.string()).default([]),
	parent: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
	short_id: z.string().optional(),
});

const snapshotsSchema = z.array(snapshotSchema);

const statsSchema = z.object({
	total_size: z.number().nonnegative(),
	total_uncompressed_size: z.number().nonnegative().default(0),
	compression_ratio: z.number().nonnegative().default(0),
	total_blob_count: z.number().int().nonnegative().default(0),
	snapshots_count: z.number().int().nonnegative().default(0),
});

const snapshotNodeSchema = z.object({
	message_type: z.literal('node'),
	name: z.string().min(1),
	type: z.string().min(1),
	path: z.string().min(1),
	size: z.number().nonnegative().optional(),
	mtime: z.string().min(1).optional(),
	permissions: z.string().min(1).optional(),
});

/**
 * Purpose-built Restic command runner for imported repositories.
 *
 * It cannot receive arbitrary Restic arguments, always uses `--no-lock` and
 * never forwards command stderr into application logs or API errors.
 */
export class ResticLegacyRepositoryInspector implements LegacyResticInspectionClient {
	async listSnapshots(repositoryPath: string, password: string): Promise<LegacyRepositorySnapshot[]> {
		const output = await this.execute('snapshots', repositoryPath, password);
		let parsed: unknown;
		try {
			parsed = JSON.parse(output);
		} catch {
			throw new LegacyRepositoryInspectionError('invalid-output');
		}

		const validation = snapshotsSchema.safeParse(parsed);
		if (!validation.success) {
			throw new LegacyRepositoryInspectionError('invalid-output');
		}

		return validation.data
			.map(snapshot => ({
				id: snapshot.id,
				shortId: snapshot.short_id || snapshot.id.slice(0, 8),
				time: snapshot.time,
				hostname: snapshot.hostname,
				tags: snapshot.tags,
				paths: snapshot.paths,
				parent: snapshot.parent,
			}))
			.sort((left, right) => Date.parse(right.time) - Date.parse(left.time));
	}

	async getRepositoryStats(repositoryPath: string, password: string): Promise<LegacyRepositoryStats> {
		const output = await this.execute('stats', repositoryPath, password);
		let parsed: unknown;
		try {
			parsed = JSON.parse(output);
		} catch {
			throw new LegacyRepositoryInspectionError('invalid-output');
		}

		const validation = statsSchema.safeParse(parsed);
		if (!validation.success) {
			throw new LegacyRepositoryInspectionError('invalid-output');
		}

		return {
			totalSize: validation.data.total_size,
			totalUncompressedSize: validation.data.total_uncompressed_size,
			compressionRatio: validation.data.compression_ratio,
			totalBlobCount: validation.data.total_blob_count,
			snapshotCount: validation.data.snapshots_count,
		};
	}

	async listSnapshotDirectory(
		repositoryPath: string,
		password: string,
		snapshotId: string,
		relativePath: string
	): Promise<LegacySnapshotDirectory> {
		const normalizedPath = normalizeLegacySnapshotPath(relativePath);
		const output = await this.execute('ls', repositoryPath, password, {
			snapshotId,
			relativePath: normalizedPath,
		});
		const entries: LegacySnapshotEntry[] = [];
		const lines = output.split(/\r?\n/).filter(line => line.trim() !== '');

		for (const line of lines) {
			let parsed: unknown;
			try {
				parsed = JSON.parse(line);
			} catch {
				throw new LegacyRepositoryInspectionError('invalid-output');
			}
			if (!this.isNodeMessage(parsed)) continue;
			const node = snapshotNodeSchema.safeParse(parsed);
			if (!node.success) {
				throw new LegacyRepositoryInspectionError('invalid-output');
			}
			const entry = this.toSnapshotEntry(node.data, normalizedPath);
			if (entry) entries.push(entry);
			if (entries.length > MAX_SNAPSHOT_DIRECTORY_ENTRIES) {
				throw new LegacyRepositoryInspectionError('output-limit');
			}
		}

		entries.sort((left, right) => {
			if (left.type === 'directory' && right.type !== 'directory') return -1;
			if (left.type !== 'directory' && right.type === 'directory') return 1;
			return left.name.localeCompare(right.name);
		});
		return { path: normalizedPath, entries };
	}

	async execute(
		operation: string,
		repositoryPath: string,
		password: string,
		details: { snapshotId?: string; relativePath?: string } = {},
		timeoutMs: number = INSPECTION_TIMEOUT_MS
	): Promise<string> {
		if (!ALLOWED_INSPECTION_OPERATIONS.has(operation)) {
			throw new LegacyRepositoryInspectionError('forbidden-operation');
		}

		const operationArgs =
			operation === 'stats'
				? ['stats', '--mode', 'raw-data']
				: operation === 'ls' && details.snapshotId !== undefined && details.relativePath !== undefined
					? ['ls', details.snapshotId, toResticSnapshotPath(details.relativePath), '--long']
					: operation === 'ls'
						? null
						: ['snapshots'];
		if (!operationArgs) {
			throw new LegacyRepositoryInspectionError('forbidden-operation');
		}
		const args = [
			'--no-lock',
			'--no-cache',
			'--json',
			'--repo',
			repositoryPath,
			...operationArgs,
		];
		const environment = { ...process.env };
		delete environment.RESTIC_REPOSITORY;
		delete environment.RESTIC_REPOSITORY_FILE;
		delete environment.RESTIC_PASSWORD_COMMAND;
		delete environment.RESTIC_PASSWORD_FILE;
		environment.RESTIC_PASSWORD = password;

		return await new Promise<string>((resolve, reject) => {
			let settled = false;
			let output = '';
			let outputBytes = 0;
			const timeout = { value: undefined as NodeJS.Timeout | undefined };
			const settle = (callback: () => void) => {
				if (settled) return;
				settled = true;
				if (timeout.value) clearTimeout(timeout.value);
				callback();
			};

			const child = spawn(getBinaryPath('restic'), args, {
				env: environment,
				shell: false,
				windowsHide: true,
				stdio: ['ignore', 'pipe', 'pipe'],
			});

			timeout.value = setTimeout(() => {
				try {
					child.kill('SIGKILL');
				} catch {
					// The child may already have exited.
				}
				settle(() => reject(new LegacyRepositoryInspectionError('timeout')));
			}, timeoutMs);

			child.on('error', () => {
				settle(() => reject(new LegacyRepositoryInspectionError('execution-failed')));
			});

			child.stdout?.on('data', (chunk: Buffer) => {
				if (settled) return;
				outputBytes += chunk.length;
				if (outputBytes > MAX_INSPECTION_OUTPUT_BYTES) {
					try {
						child.kill('SIGKILL');
					} catch {
						// The child may already have exited.
					}
					settle(() => reject(new LegacyRepositoryInspectionError('output-limit')));
					return;
				}
				output += chunk.toString();
			});

			// Consume stderr so it cannot back up the process pipe, but never retain,
			// log, or return it: it can include repository/backend details.
			child.stderr?.on('data', () => undefined);

			child.on('close', code => {
				if (settled) return;
				if (code === 0) {
					settle(() => resolve(output));
					return;
				}
				if (code === 12) {
					settle(() => reject(new LegacyRepositoryInspectionError('wrong-password')));
					return;
				}
				if (code === 10) {
					settle(() => reject(new LegacyRepositoryInspectionError('repository-unavailable')));
					return;
				}
				if (operation === 'ls' && code === 1) {
					settle(() => reject(new LegacyRepositoryInspectionError('snapshot-path-not-found')));
					return;
				}
				settle(() => reject(new LegacyRepositoryInspectionError('execution-failed')));
			});
		});
	}

	private isNodeMessage(value: unknown): value is { message_type: 'node' } {
		return typeof value === 'object' && value !== null && (value as { message_type?: unknown }).message_type === 'node';
	}

	private toSnapshotEntry(
		node: z.infer<typeof snapshotNodeSchema>,
		requestedPath: string
	): LegacySnapshotEntry | null {
		if (!node.path.startsWith('/')) {
			throw new LegacyRepositoryInspectionError('invalid-output');
		}
		let relativePath: string;
		try {
			relativePath = normalizeLegacySnapshotPath(node.path.slice(1), false);
		} catch {
			throw new LegacyRepositoryInspectionError('invalid-output');
		}
		if (relativePath === requestedPath || getLegacySnapshotParent(relativePath) !== requestedPath) {
			return null;
		}

		const name = path.posix.basename(relativePath);
		const type = node.type === 'dir' ? 'directory' : node.type === 'file' ? 'file' : node.type === 'symlink' ? 'symlink' : 'other';
		return {
			name,
			path: relativePath,
			type,
			size: typeof node.size === 'number' ? node.size : null,
			modifiedAt: node.mtime || null,
			permissions: node.permissions || null,
			isSymlink: type === 'symlink',
		};
	}
}
