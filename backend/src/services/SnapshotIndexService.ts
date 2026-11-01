import { randomUUID } from 'crypto';
import { readdir, rename, rm, utimes } from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { Worker } from 'worker_threads';
import {
	SnapshotIndexFailureCode,
	SnapshotIndexOrigin,
	SnapshotIndexStage,
	SnapshotIndexStatus,
	SnapshotListFormat,
} from '../types/snapshotIndex';
import { AppError } from '../utils/AppError';
import { appPaths } from '../utils/AppPaths';
import { readIndexMeta } from '../utils/snapshotIndex/SnapshotIndexReader';
import { getSnapshotIndexWorker } from '../utils/snapshotIndex/workerLocator';

const STALL_LIMIT = 90_000;
const STALL_CHECK_INTERVAL = 15_000;
const QUEUE_POLL_LIMIT = 120_000;
const TOUCH_INTERVAL = 3_600_000;
const RENAME_TRIES = 5;
const RENAME_RETRY_DELAY = 200;
const STORED_LIST_TIME_LIMIT = 3_600_000;
const STORED_LIST_MAX_BYTES = 64 * 1024 ** 3;
const CACHE_ID = /^[A-Za-z0-9_-]+$/;
const BUILD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** IDs become cache file names, and a mirror ID can come from an event. */
export function assertCacheIds(...ids: (string | undefined)[]) {
	if (ids.some(id => id && !CACHE_ID.test(id))) {
		throw new AppError(400, 'invalid_id');
	}
}

/** Windows antivirus can hold a new file for a short time. */
export async function renameWithRetry(from: string, to: string) {
	for (let attempt = 1; ; attempt++) {
		try {
			await rename(from, to);
			return;
		} catch (error) {
			if (attempt === RENAME_TRIES) {
				throw error;
			}
			await new Promise(resolve => setTimeout(resolve, RENAME_RETRY_DELAY));
		}
	}
}

export class SnapshotIndexError extends Error {
	constructor(
		public code: SnapshotIndexFailureCode,
		message: string
	) {
		super(message);
	}
}

interface SnapshotIndexBuild {
	key: string;
	buildId: string;
	backupId: string;
	replicationId?: string;
	sourceId?: string;
	stage: SnapshotIndexStage;
	entries: number;
	total?: number;
	failure?: { code: SnapshotIndexFailureCode; error: string };
	lastProgress: number;
	lastPolled: number;
	// The source sends progress events, so silence means it is gone.
	heartbeat: boolean;
	ended: boolean;
	waiting: boolean;
	cancel?: (error: Error) => void;
	stillExists: () => Promise<boolean>;
}

export interface SnapshotIndexStartOptions {
	backupId: string;
	replicationId?: string;
	sourceId?: string;
	stillExists: () => Promise<boolean>;
	/** Runs the listing. A result with a build ID means the source reports by events. */
	run: (buildId: string) => Promise<{ buildId?: string } | void>;
}

export interface SnapshotIndexIngestOptions {
	origin: SnapshotIndexOrigin;
	snapshotId: string;
	expectedLines?: number;
	format?: SnapshotListFormat; // default is restic
	producer?: () => Promise<unknown>; // Starts the source when the build gets its turn
}

function failureCode(error: any): SnapshotIndexFailureCode {
	if (error instanceof SnapshotIndexError) {
		return error.code;
	}
	if (error?.code === 'integrity') {
		return 'integrity';
	}
	if (error?.code === 'SQLITE_FULL' || error?.code === 'ENOSPC') {
		return 'disk_full';
	}
	return error?.stalled ? 'stalled' : 'unknown';
}

class SnapshotIndexWorker {
	private worker: Worker;
	private pending?: { resolve: (message: any) => void; reject: (error: Error) => void };
	private failure?: Error;

	constructor(
		workerData: object,
		private onLines: (lines: number) => void
	) {
		const { filename, ...options } = getSnapshotIndexWorker();
		this.worker = new Worker(filename, { ...options, workerData });
		this.worker.on('message', message => {
			if (message.type === 'error') {
				const error: any = new Error(message.message);
				error.code = message.code;
				this.reject(error);
				return;
			}
			this.onLines(message.lines);
			this.pending?.resolve(message);
			this.pending = undefined;
		});
		this.worker.on('error', error => this.reject(error));
		this.worker.on('exit', () => this.reject(new Error('The index worker stopped')));
	}

	reject(error: Error) {
		this.failure ??= error;
		this.pending?.reject(error);
		this.pending = undefined;
	}

	private request(send: () => void): Promise<any> {
		if (this.failure) {
			return Promise.reject(this.failure);
		}
		return new Promise((resolve, reject) => {
			this.pending = { resolve, reject };
			send();
		});
	}

	// Pool-backed buffers cannot be transferred, so each chunk gets its own memory.
	send(chunk: Buffer): Promise<void> {
		const data = new Uint8Array(chunk);
		return this.request(() =>
			this.worker.postMessage({ type: 'chunk', data }, [data.buffer as ArrayBuffer])
		);
	}

	finish(snapshotId: string): Promise<{ lines: number }> {
		return this.request(() => this.worker.postMessage({ type: 'end', snapshotId }));
	}

	stop(): Promise<number> {
		return this.worker.terminate();
	}
}

export class SnapshotIndexService {
	private builds = new Map<string, SnapshotIndexBuild>();
	private tombstones = new Set<string>();
	private turnTaken = false;
	private waiters: { build: SnapshotIndexBuild; resolve: (served: boolean) => void }[] = [];
	private touched = new Map<string, number>();
	private stallTimer?: NodeJS.Timeout;
	private clearListeners: ((backupId: string) => Promise<void>)[] = [];

	/** The listener stops work that reads the index, before its files are removed. */
	onClear(listener: (backupId: string) => Promise<void>) {
		this.clearListeners.push(listener);
	}

	private keyOf(backupId: string, replicationId?: string): string {
		return `${backupId}|${replicationId || ''}`;
	}

	private find(buildId: string, sourceId?: string): SnapshotIndexBuild | undefined {
		for (const build of this.builds.values()) {
			if (
				build.buildId === buildId &&
				!build.failure &&
				(sourceId === undefined || build.sourceId === sourceId)
			) {
				return build;
			}
		}
		return undefined;
	}

	getIndexFile(backupId: string, replicationId?: string): string {
		assertCacheIds(backupId, replicationId);
		const suffix = replicationId ? `-${replicationId}` : '';
		return path.join(appPaths.getCacheDir(), `snapshot-index-${backupId}${suffix}.sqlite`);
	}

	/** Returns the index file for a read. The cleanup task keeps a file that is in use. */
	openIndexFile(backupId: string, replicationId?: string): string {
		const file = this.getIndexFile(backupId, replicationId);
		const now = Date.now();
		if (now - (this.touched.get(file) ?? 0) >= TOUCH_INTERVAL) {
			this.touched.set(file, now);
			utimes(file, new Date(now), new Date(now)).catch(() => {});
		}
		return file;
	}

	status(backupId: string, replicationId?: string): SnapshotIndexStatus {
		const build = this.builds.get(this.keyOf(backupId, replicationId));
		if (build) {
			build.lastPolled = Date.now();
			if (build.failure) {
				return { state: 'failed', ...build.failure };
			}
			return {
				state: 'building',
				stage: build.stage,
				entries: build.entries,
				...(build.total !== undefined && { total: build.total }),
			};
		}
		const meta = readIndexMeta(this.getIndexFile(backupId, replicationId));
		if (!meta) {
			return { state: 'none' };
		}
		return {
			state: 'ready',
			snapshotId: meta.snapshotId,
			builtAt: meta.builtAt,
			stats: meta.stats,
		};
	}

	/** Idempotent: a running build or a ready index stays as it is. */
	start(options: SnapshotIndexStartOptions): SnapshotIndexStatus {
		const { backupId, replicationId } = options;
		const current = this.status(backupId, replicationId);
		if (current.state === 'building' || current.state === 'ready') {
			return current;
		}
		const now = Date.now();
		const build: SnapshotIndexBuild = {
			key: this.keyOf(backupId, replicationId),
			buildId: randomUUID(),
			backupId,
			replicationId,
			sourceId: options.sourceId,
			stage: 'queued',
			entries: 0,
			lastProgress: now,
			lastPolled: now,
			heartbeat: false,
			ended: false,
			waiting: false,
			stillExists: options.stillExists,
		};
		this.builds.set(build.key, build);
		this.watchStalls();
		options
			.run(build.buildId)
			.then(result => {
				if (!result?.buildId || build.ended) {
					return;
				}
				if (!BUILD_ID.test(result.buildId)) {
					this.failBuild(build, 'unknown', 'The source sent an invalid build ID');
					return;
				}
				build.buildId = result.buildId;
				build.lastProgress = Date.now();
				build.heartbeat = true;
			})
			.catch(error => this.failBuild(build, failureCode(error), error?.message || String(error)));
		return this.status(backupId, replicationId);
	}

	hasBuild(buildId: string, sourceId?: string): boolean {
		return !!this.find(buildId, sourceId);
	}

	/** Names the source that runs the build, if it is not the one that start was given. */
	assignSource(buildId: string, sourceId: string) {
		const build = this.find(buildId);
		if (build) {
			build.sourceId = sourceId;
		}
	}

	progress(
		buildId: string,
		update: { stage?: SnapshotIndexStage; entries?: number },
		sourceId?: string
	) {
		const build = this.find(buildId, sourceId);
		if (!build || build.waiting || build.cancel) {
			return;
		}
		build.lastProgress = Date.now();
		build.stage = update.stage ?? build.stage;
		build.entries = update.entries ?? build.entries;
	}

	fail(buildId: string, code: SnapshotIndexFailureCode, error: string, sourceId?: string) {
		const build = this.find(buildId, sourceId);
		if (build) {
			this.failBuild(build, code, error);
		}
	}

	/** Fails builds that wait for a source. Builds on this server are not affected. */
	failBySource(sourceId: string, code: SnapshotIndexFailureCode, error: string) {
		for (const build of this.builds.values()) {
			if (
				build.sourceId === sourceId &&
				build.heartbeat &&
				!build.failure &&
				!build.cancel &&
				!build.waiting
			) {
				this.failBuild(build, code, error);
			}
		}
	}

	private failBuild(build: SnapshotIndexBuild, code: SnapshotIndexFailureCode, error: string) {
		if (build.ended) {
			return;
		}
		build.ended = true;
		build.failure = { code, error };
		build.cancel?.(new SnapshotIndexError(code, error));
	}

	/** Stops builds of a backup and removes its index files. The backup stays cleared. */
	async clear(backupId: string) {
		this.tombstones.add(backupId);
		for (const build of [...this.builds.values()]) {
			if (build.backupId === backupId) {
				this.builds.delete(build.key);
				build.ended = true;
				build.cancel?.(new SnapshotIndexError('unknown', 'The backup was removed'));
			}
		}
		await Promise.all(this.clearListeners.map(listener => listener(backupId)));
		const cacheDir = appPaths.getCacheDir();
		const prefix = `snapshot-index-${backupId}`;
		let files: string[] = [];
		try {
			files = await readdir(cacheDir);
		} catch {}
		for (const file of files) {
			if (
				file === `${prefix}.sqlite` ||
				(file.startsWith(`${prefix}-`) && file.endsWith('.sqlite'))
			) {
				await rm(path.join(cacheDir, file), { force: true, maxRetries: 3, retryDelay: 200 });
			}
		}
	}

	private takeTurn(build: SnapshotIndexBuild): Promise<boolean> {
		if (!this.turnTaken) {
			this.turnTaken = true;
			return Promise.resolve(true);
		}
		build.waiting = true;
		build.stage = 'queued';
		return new Promise(resolve => this.waiters.push({ build, resolve }));
	}

	private releaseTurn() {
		const now = Date.now();
		for (let waiter = this.waiters.shift(); waiter; waiter = this.waiters.shift()) {
			const { build, resolve } = waiter;
			build.waiting = false;
			if (build.ended) {
				resolve(false);
				continue;
			}
			if (now - build.lastPolled > QUEUE_POLL_LIMIT) {
				this.builds.delete(build.key);
				build.ended = true;
				resolve(false);
				continue;
			}
			resolve(true);
			return;
		}
		this.turnTaken = false;
	}

	/** Builds the index from raw restic lines. A failure sets the build state. */
	async ingest(buildId: string, source: Readable, options: SnapshotIndexIngestOptions) {
		const build = this.find(buildId);
		if (!build) {
			source.destroy();
			return;
		}
		if (!(await this.takeTurn(build))) {
			source.destroy();
			return;
		}

		const filePath = path.join(appPaths.getCacheDir(), `snapshot-${randomUUID()}.tmp`);
		let worker: SnapshotIndexWorker | undefined;
		let deadline: NodeJS.Timeout | undefined;
		try {
			// The source is done, and a long finish step sends no lines.
			build.heartbeat = false;
			build.stage = 'indexing';
			build.entries = 0;
			build.total = options.expectedLines;
			const indexWorker = new SnapshotIndexWorker(
				{
					filePath,
					meta: {
						backupId: build.backupId,
						replicationId: build.replicationId,
						origin: options.origin,
					},
					format: options.format,
				},
				lines => {
					build.entries = lines;
					build.lastProgress = Date.now();
				}
			);
			worker = indexWorker;
			build.cancel = error => {
				source.destroy(error);
				indexWorker.reject(error);
			};

			// A stored list holds the only build turn, and no stall limit applies to it.
			const stored = !options.producer;
			if (stored) {
				deadline = setTimeout(
					() => this.failBuild(build, 'stalled', 'The file list took too long to index'),
					STORED_LIST_TIME_LIMIT
				);
			}
			const maxBytes = stored ? STORED_LIST_MAX_BYTES : Infinity;
			const maxLines = options.expectedLines ?? Infinity;
			let received = 0;

			const produced = options.producer?.();
			produced?.catch(error => source.destroy(error));
			for await (const chunk of source) {
				await indexWorker.send(chunk);
				received += chunk.length;
				if (received > maxBytes || build.entries > maxLines) {
					throw new SnapshotIndexError('integrity', 'The file list is larger than expected');
				}
			}
			await produced;

			const { lines } = await indexWorker.finish(options.snapshotId);
			if (options.expectedLines !== undefined && lines !== options.expectedLines) {
				throw new SnapshotIndexError(
					'integrity',
					`The file list has ${lines} lines, expected ${options.expectedLines}`
				);
			}
			await this.publish(build, filePath);
		} catch (error: any) {
			this.failBuild(build, failureCode(error), error?.message || String(error));
		} finally {
			clearTimeout(deadline);
			build.cancel = undefined;
			await worker?.stop();
			await rm(filePath, { force: true, maxRetries: 3, retryDelay: 200 }).catch(() => {});
			this.releaseTurn();
		}
	}

	private async publish(build: SnapshotIndexBuild, filePath: string) {
		if (build.ended || this.tombstones.has(build.backupId) || !(await build.stillExists())) {
			this.builds.delete(build.key);
			build.ended = true;
			return;
		}
		const finalPath = this.getIndexFile(build.backupId, build.replicationId);
		await renameWithRetry(filePath, finalPath);
		this.builds.delete(build.key);
		build.ended = true;
		if (this.tombstones.has(build.backupId)) {
			await rm(finalPath, { force: true, maxRetries: 3, retryDelay: 200 });
		}
	}

	checkStalls() {
		const now = Date.now();
		let active = false;
		for (const build of this.builds.values()) {
			if (build.ended) {
				continue;
			}
			active = true;
			if (build.heartbeat && !build.waiting && now - build.lastProgress > STALL_LIMIT) {
				this.failBuild(build, 'stalled', 'The agent stopped sending progress');
			}
		}
		if (!active && this.stallTimer) {
			clearInterval(this.stallTimer);
			this.stallTimer = undefined;
		}
	}

	private watchStalls() {
		if (!this.stallTimer) {
			this.stallTimer = setInterval(() => this.checkStalls(), STALL_CHECK_INTERVAL);
			this.stallTimer.unref();
		}
	}
}

export const snapshotIndexService = new SnapshotIndexService();
