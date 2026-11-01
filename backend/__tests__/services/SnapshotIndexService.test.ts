import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { buildSync } from 'esbuild';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { PassThrough, Readable } from 'stream';
import { SnapshotIndexError, SnapshotIndexService } from '../../src/services/SnapshotIndexService';
import { listIndexEntries } from '../../src/utils/snapshotIndex/SnapshotIndexReader';

const mockWorker = { file: '' };
const mockPaths = { cache: '' };

jest.mock('../../src/utils/snapshotIndex/workerLocator', () => ({
	getSnapshotIndexWorker: () => ({ filename: mockWorker.file }),
}));

jest.mock('../../src/utils/AppPaths', () => ({
	appPaths: { getCacheDir: () => mockPaths.cache },
}));

const header = '{"paths":["/d"],"id":"snap1","message_type":"snapshot"}\n';

function lines(count: number, prefix = 'f'): string {
	let text = header;
	for (let i = 0; i < count; i++) {
		text += JSON.stringify({ path: `/d/${prefix}${i}`, type: 'file', size: 1 }) + '\n';
	}
	return text;
}

async function waitFor(check: () => boolean) {
	for (let i = 0; i < 2000 && !check(); i++) {
		await new Promise(resolve => setTimeout(resolve, 5));
	}
	expect(check()).toBe(true);
}

describe('SnapshotIndexService', () => {
	let root: string;
	let service: SnapshotIndexService;

	beforeAll(() => {
		const outDir = path.join(process.cwd(), 'node_modules', '.cache', 'snapshot-index-test');
		mkdirSync(outDir, { recursive: true });
		mockWorker.file = path.join(outDir, 'worker.cjs');
		buildSync({
			entryPoints: ['src/workers/snapshotIndexWorker.ts'],
			bundle: true,
			platform: 'node',
			format: 'cjs',
			external: ['better-sqlite3'],
			outfile: mockWorker.file,
		});
	});

	beforeEach(() => {
		root = mkdtempSync(path.join(os.tmpdir(), 'snapshot-index-service-'));
		mockPaths.cache = root;
		service = new SnapshotIndexService();
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	/** Starts a build that waits for ingest, as a source with events does. */
	function startBuild(backupId = 'b1', extra: object = {}) {
		let buildId = '';
		service.start({
			backupId,
			stillExists: async () => true,
			run: async id => {
				buildId = id;
				return { buildId: id };
			},
			...extra,
		});
		return () => buildId;
	}

	function source(text: string): Readable {
		return Readable.from([Buffer.from(text)]);
	}

	it('builds from rclone lines and keeps the source roots', async () => {
		const getId = startBuild('source-1');
		await waitFor(() => !!getId());
		const text = [
			'{"srcPath":"C:\\\\data"}',
			'[',
			'{"Path":"sub","Name":"sub","Size":0,"ModTime":"2026-01-01T00:00:00Z","IsDir":true},',
			'{"Path":"sub/a.txt","Name":"a.txt","Size":5,"ModTime":"2026-01-01T00:00:00Z","IsDir":false}',
			']',
			'{"srcPath":"/home"}',
			'[',
			']',
			'',
		].join('\n');
		await service.ingest(getId(), source(text), {
			origin: 'remote',
			snapshotId: '',
			expectedLines: 8,
			format: 'rclone',
		});

		expect(service.status('source-1')).toMatchObject({
			state: 'ready',
			// /C, /C/data, /C/data/sub, the file, and the empty /home.
			stats: { entries: 5, files: 1, dirs: 4, bytes: 5 },
		});
		const { rows } = listIndexEntries(service.getIndexFile('source-1'), { dir: '/C/data/sub' });
		expect(rows.map(row => row.path)).toEqual(['/C/data/sub/a.txt']);
		const db = new Database(service.getIndexFile('source-1'), { readonly: true });
		const sources = db.prepare("SELECT value FROM meta WHERE key = 'sources'").pluck().get() as string;
		db.close();
		expect(JSON.parse(sources)).toEqual([
			{ root: '/C/data', srcPath: 'C:\\data' },
			{ root: '/home', srcPath: '/home' },
		]);
	});

	it('builds from raw lines split at any byte', async () => {
		const getId = startBuild();
		await waitFor(() => !!getId());
		const text = lines(2000);
		const chunks = [text.slice(0, 7), text.slice(7, 8000), text.slice(8000)].map(c => Buffer.from(c));
		await service.ingest(getId(), Readable.from(chunks), {
			origin: 'remote',
			snapshotId: 'snap1',
			expectedLines: 2001,
		});

		expect(service.status('b1')).toMatchObject({
			state: 'ready',
			snapshotId: 'snap1',
			stats: { entries: 2001, files: 2000, dirs: 1, bytes: 2000 },
		});
		const { total } = listIndexEntries(service.getIndexFile('b1'), { dir: '/d' });
		expect(total).toBe(2000);
		expect(readdirSync(root).filter(f => f.endsWith('.tmp'))).toEqual([]);
	});

	it('is idempotent while building and when ready', async () => {
		const run = jest.fn(async (id: string) => ({ buildId: id }));
		const options = { backupId: 'b1', stillExists: async () => true, run };
		expect(service.start(options)).toMatchObject({ state: 'building', stage: 'queued' });
		expect(service.start(options)).toMatchObject({ state: 'building' });
		expect(run).toHaveBeenCalledTimes(1);

		const buildId = run.mock.calls[0][0];
		await service.ingest(buildId, source(lines(1)), { origin: 'remote', snapshotId: 'snap1' });
		expect(service.start(options)).toMatchObject({ state: 'ready' });
		expect(run).toHaveBeenCalledTimes(1);
	});

	it('uses a separate file per storage', async () => {
		const getId = startBuild('b1', { replicationId: 'r1' });
		await waitFor(() => !!getId());
		await service.ingest(getId(), source(lines(1)), { origin: 'remote', snapshotId: 'snap1' });
		expect(service.status('b1', 'r1').state).toBe('ready');
		expect(service.status('b1').state).toBe('none');
		expect(existsSync(path.join(root, 'snapshot-index-b1-r1.sqlite'))).toBe(true);
	});

	it('takes the build ID that the source returns', async () => {
		const buildId = randomUUID();
		service.start({
			backupId: 'b1',
			stillExists: async () => true,
			run: async () => ({ buildId }),
		});
		await waitFor(() => service.hasBuild(buildId));
		await service.ingest(buildId, source(lines(1)), { origin: 'remote', snapshotId: 's' });
		expect(service.status('b1').state).toBe('ready');
	});

	it('refuses a returned build ID that is not a UUID', async () => {
		const buildId = '../../x/victim';
		service.start({
			backupId: 'b1',
			stillExists: async () => true,
			run: async () => ({ buildId }),
		});
		await waitFor(() => service.status('b1').state === 'failed');
		expect(service.hasBuild(buildId)).toBe(false);
	});

	it('does not put the build ID in the temp file name', async () => {
		const getId = startBuild();
		await waitFor(() => !!getId());
		const list = new PassThrough();
		const ingest = service.ingest(getId(), list, { origin: 'remote', snapshotId: 's' });
		await waitFor(() => readdirSync(root).some(f => f.endsWith('.tmp')));
		expect(readdirSync(root).join()).not.toContain(getId());
		list.end(lines(1));
		await ingest;
	});

	it.each(['../x', '..\\x', '/x', 'a.b', 'a b'])('refuses %s as a cache file ID', id => {
		expect(() => service.getIndexFile(id)).toThrow('invalid_id');
		expect(() => service.getIndexFile('b1', id)).toThrow('invalid_id');
		expect(() => service.status('b1', id)).toThrow('invalid_id');
	});

	it('accepts the ID forms that the app makes', () => {
		for (const id of ['a1b2c3d4e5f6', 'V1StGXR8_Z5jdHi6B-myT', 'source-a1b2-0123456789abcdef']) {
			expect(service.getIndexFile('b1', id)).toBe(
				path.join(root, `snapshot-index-b1-${id}.sqlite`)
			);
		}
	});

	it('fails a line that does not end at the size limit', async () => {
		const getId = startBuild();
		await waitFor(() => !!getId());
		const chunks = Array.from({ length: 8 }, () => Buffer.alloc(256 * 1024, 'a'));
		await service.ingest(getId(), Readable.from(chunks), { origin: 'remote', snapshotId: 's' });
		expect(service.status('b1')).toMatchObject({ state: 'failed', code: 'integrity' });
		expect(readdirSync(root)).toEqual([]);
	});

	it('stops when a list has more lines than it declared', async () => {
		const getId = startBuild();
		await waitFor(() => !!getId());
		const rest = new PassThrough();
		const ingest = service.ingest(getId(), rest, {
			origin: 'remote',
			snapshotId: 's',
			expectedLines: 2,
		});
		rest.write(lines(5));
		await ingest;
		expect(service.status('b1')).toMatchObject({
			state: 'failed',
			code: 'integrity',
			error: 'The file list is larger than expected',
		});
		expect(rest.destroyed).toBe(true);
	});

	it('indexes a long run of slashes in linear time', async () => {
		const getId = startBuild();
		await waitFor(() => !!getId());
		const line = JSON.stringify({ path: '/'.repeat(900_000) + 'a', type: 'file', size: 1 }) + '\n';
		const started = Date.now();
		await service.ingest(getId(), source(header + line), { origin: 'remote', snapshotId: 's' });
		expect(Date.now() - started).toBeLessThan(5000);
		expect(service.status('b1').state).not.toBe('building');
	});

	it('stops a stored list at the time limit and frees the turn', async () => {
		const timer = jest.spyOn(global, 'setTimeout');
		const limit = () => timer.mock.calls.find(([, delay]) => delay === 3_600_000);
		try {
			const getId = startBuild('b1');
			const getNext = startBuild('b2');
			await waitFor(() => !!getId() && !!getNext());
			const stuck = service.ingest(getId(), new PassThrough(), { origin: 'remote', snapshotId: 's' });
			const next = service.ingest(getNext(), source(lines(1)), { origin: 'remote', snapshotId: 's' });
			await waitFor(() => !!limit());

			(limit()![0] as () => void)();
			await Promise.all([stuck, next]);
			expect(service.status('b1')).toMatchObject({ state: 'failed', code: 'stalled' });
			expect(service.status('b2').state).toBe('ready');
		} finally {
			timer.mockRestore();
		}
	});

	it('gives no time limit to a list that a producer writes', async () => {
		const timer = jest.spyOn(global, 'setTimeout');
		try {
			const getId = startBuild();
			await waitFor(() => !!getId());
			const list = new PassThrough();
			await service.ingest(getId(), list, {
				origin: 'local',
				snapshotId: 's',
				producer: async () => list.end(lines(1)),
			});
			expect(service.status('b1').state).toBe('ready');
			expect(timer.mock.calls.some(([, delay]) => delay === 3_600_000)).toBe(false);
		} finally {
			timer.mockRestore();
		}
	});

	it('runs one build at a time in order', async () => {
		const ids = ['b1', 'b2', 'b3'].map(id => startBuild(id));
		await waitFor(() => ids.every(id => !!id()));
		const firstSource = new PassThrough();
		const order: string[] = [];
		const first = service
			.ingest(ids[0](), firstSource, { origin: 'remote', snapshotId: 's' })
			.then(() => order.push('b1'));
		const second = service
			.ingest(ids[1](), source(lines(1)), { origin: 'remote', snapshotId: 's' })
			.then(() => order.push('b2'));
		const third = service
			.ingest(ids[2](), source(lines(1)), { origin: 'remote', snapshotId: 's' })
			.then(() => order.push('b3'));

		await new Promise(resolve => setTimeout(resolve, 100));
		expect(service.status('b2')).toMatchObject({ state: 'building', stage: 'queued' });
		expect(service.status('b1')).toMatchObject({ state: 'building', stage: 'indexing' });
		firstSource.end(lines(1));
		await Promise.all([first, second, third]);
		expect(order).toEqual(['b1', 'b2', 'b3']);
	});

	it('skips a queued build that no client polls', async () => {
		const ids = ['b1', 'b2'].map(id => startBuild(id));
		await waitFor(() => ids.every(id => !!id()));
		const firstSource = new PassThrough();
		const first = service.ingest(ids[0](), firstSource, { origin: 'remote', snapshotId: 's' });
		const secondSource = source(lines(1));
		const second = service.ingest(ids[1](), secondSource, { origin: 'remote', snapshotId: 's' });
		await new Promise(resolve => setTimeout(resolve, 50));

		const realNow = Date.now;
		Date.now = () => realNow() + 130_000;
		firstSource.end(lines(1));
		await Promise.all([first, second]);
		Date.now = realNow;
		expect(service.status('b2').state).toBe('none');
		expect(secondSource.destroyed).toBe(true);
	});

	it('fails a build when progress stops, and accepts progress before that', async () => {
		const getId = startBuild();
		await waitFor(() => !!getId());
		const realNow = Date.now;
		try {
			Date.now = () => realNow() + 80_000;
			service.checkStalls();
			expect(service.status('b1').state).toBe('building');
			service.progress(getId(), { stage: 'listing', entries: 40 });
			expect(service.status('b1')).toMatchObject({ stage: 'listing', entries: 40 });

			Date.now = () => realNow() + 165_000;
			service.checkStalls();
			expect(service.status('b1').state).toBe('building');
			Date.now = () => realNow() + 175_000;
			service.checkStalls();
			expect(service.status('b1')).toMatchObject({ state: 'failed', code: 'stalled' });
		} finally {
			Date.now = realNow;
		}
	});

	it('does not check progress while it builds on this server', async () => {
		const getId = startBuild();
		await waitFor(() => !!getId());
		await new Promise(resolve => setTimeout(resolve, 10));
		const stream = new PassThrough();
		const done = service.ingest(getId(), stream, { origin: 'remote', snapshotId: 's' });
		await new Promise(resolve => setTimeout(resolve, 50));
		const realNow = Date.now;
		Date.now = () => realNow() + 600_000;
		service.checkStalls();
		Date.now = realNow;
		expect(service.status('b1').state).toBe('building');
		stream.end(lines(1));
		await done;
		expect(service.status('b1').state).toBe('ready');
	});

	it('does not check progress for a source without events', async () => {
		service.start({
			backupId: 'b1',
			stillExists: async () => true,
			run: () => new Promise(() => {}),
		});
		const realNow = Date.now;
		Date.now = () => realNow() + 600_000;
		service.checkStalls();
		Date.now = realNow;
		expect(service.status('b1').state).toBe('building');
	});

	it('fails on a line count that differs from the signed count', async () => {
		const getId = startBuild();
		await waitFor(() => !!getId());
		await service.ingest(getId(), source(lines(5)), {
			origin: 'remote',
			snapshotId: 's',
			expectedLines: 7,
		});
		expect(service.status('b1')).toMatchObject({ state: 'failed', code: 'integrity' });
		expect(readdirSync(root)).toEqual([]);
	});

	it('fails on a bad line and removes the temporary file', async () => {
		const getId = startBuild();
		await waitFor(() => !!getId());
		await service.ingest(getId(), source(header + 'not json\n'), {
			origin: 'remote',
			snapshotId: 's',
		});
		expect(service.status('b1')).toMatchObject({ state: 'failed', code: 'unknown' });
		await waitFor(() => readdirSync(root).length === 0);
	});

	it('fails when the producer rejects, also after the source ended', async () => {
		const getId = startBuild();
		await waitFor(() => !!getId());
		const error: any = new Error('restic failed');
		error.stalled = true;
		await service.ingest(getId(), source(lines(1)), {
			origin: 'local',
			snapshotId: 's',
			producer: async () => {
				await new Promise(resolve => setTimeout(resolve, 50));
				throw error;
			},
		});
		expect(service.status('b1')).toMatchObject({ state: 'failed', code: 'stalled' });
		expect(readdirSync(root)).toEqual([]);
	});

	it('keeps the failure code of a run that throws', async () => {
		service.start({
			backupId: 'b1',
			stillExists: async () => true,
			run: async () => {
				throw new SnapshotIndexError('agent_offline', 'The agent is offline');
			},
		});
		await waitFor(() => service.status('b1').state === 'failed');
		expect(service.status('b1')).toEqual({
			state: 'failed',
			code: 'agent_offline',
			error: 'The agent is offline',
		});
	});

	it('restarts after a failure', async () => {
		const getId = startBuild();
		await waitFor(() => !!getId());
		service.fail(getId(), 'unknown', 'failed');
		expect(service.status('b1').state).toBe('failed');
		startBuild();
		expect(service.status('b1').state).toBe('building');
	});

	it('ignores an unknown build', async () => {
		const stream = source(lines(1));
		await service.ingest('nope', stream, { origin: 'remote', snapshotId: 's' });
		expect(stream.destroyed).toBe(true);
		expect(service.hasBuild('nope')).toBe(false);
	});

	it('does not rename after clear', async () => {
		const getId = startBuild();
		await waitFor(() => !!getId());
		const stream = new PassThrough();
		const done = service.ingest(getId(), stream, { origin: 'remote', snapshotId: 's' });
		stream.write(lines(1));
		await new Promise(resolve => setTimeout(resolve, 50));
		await service.clear('b1');
		stream.end();
		await done;
		expect(readdirSync(root)).toEqual([]);
		expect(service.status('b1').state).toBe('none');
	});

	it('does not rename when the backup is gone', async () => {
		const getId = startBuild('b1', { stillExists: async () => false });
		await waitFor(() => !!getId());
		await service.ingest(getId(), source(lines(1)), { origin: 'remote', snapshotId: 's' });
		expect(readdirSync(root)).toEqual([]);
		expect(service.status('b1').state).toBe('none');
	});

	it('clear removes the files of all storages and no others', async () => {
		for (const name of ['b1', 'b1-r1', 'b12', 'b2']) {
			writeFileSync(path.join(root, `snapshot-index-${name}.sqlite`), '');
		}
		await service.clear('b1');
		expect(readdirSync(root).sort()).toEqual([
			'snapshot-index-b12.sqlite',
			'snapshot-index-b2.sqlite',
		]);
	});

	it('failBySource fails waiting builds of that source only', async () => {
		const mine = startBuild('b1', { sourceId: 'device-1' });
		const other = startBuild('b2', { sourceId: 'device-2' });
		await waitFor(() => !!mine() && !!other());
		await new Promise(resolve => setTimeout(resolve, 10));
		service.failBySource('device-1', 'unknown', 'restarted');
		expect(service.status('b1').state).toBe('failed');
		expect(service.status('b2').state).toBe('building');
	});
});
