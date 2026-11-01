import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { SnapShotFile } from '../../../src/types/restic';
import { parseResticLine, snapshotFilesToLines } from '../../../src/utils/restic/helpers';
import {
	listIndexDirs,
	listIndexEntries,
	readIndexMeta,
	resolveIndexSelection,
} from '../../../src/utils/snapshotIndex/SnapshotIndexReader';
import { SnapshotIndexWriter } from '../../../src/utils/snapshotIndex/SnapshotIndexWriter';

const MTIME = '2026-10-29T22:27:11.4099993+06:00';
const NOT_READY = expect.objectContaining({ statusCode: 409, message: 'index_not_ready' });

function entry(p: string, type = 'file', size = 0, mtime: number | null = 1000, perm = '-rw') {
	return { path: p, type, size, mtime, perm };
}

describe('snapshot index', () => {
	let dir: string;
	let file: string;

	beforeEach(() => {
		dir = mkdtempSync(path.join(os.tmpdir(), 'snapshot-index-'));
		file = path.join(dir, 'index.sqlite');
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	function build(entries: ReturnType<typeof entry>[], origin: 'local' | 'remote' = 'remote') {
		const writer = new SnapshotIndexWriter(file, { backupId: 'b1', origin });
		entries.forEach(e => writer.add(e));
		return writer.finish('snap1');
	}

	const tree = [
		entry('/a', 'dir'),
		entry('/a/b', 'dir'),
		entry('/a/b/one.txt', 'file', 10),
		entry('/a/b/two.txt', 'file', 20),
		entry('/a/c', 'dir'),
		entry('/a/c/three.txt', 'file', 30),
		entry('/a/four.txt', 'file', 40),
		entry('/d', 'dir'),
		entry('/d/five.txt', 'file', 50),
		entry('/six.txt', 'file', 60),
	];

	describe('parseResticLine', () => {
		it('skips the snapshot line and reads a node line', () => {
			expect(parseResticLine('{"paths":["/a"],"id":"x","message_type":"snapshot"}')).toBeNull();
			const line = JSON.stringify({
				name: 'x',
				type: 'file',
				path: '/a/x',
				size: 7,
				permissions: '-rw-r--r--',
				mtime: MTIME,
			});
			expect(parseResticLine(line)).toEqual({
				path: '/a/x',
				type: 'file',
				size: 7,
				mtime: new Date(MTIME).getTime(),
				perm: '-rw-r--r--',
			});
		});

		it('keeps a missing size as 0 and a bad mtime as null', () => {
			const parsed = parseResticLine('{"path":"/a","type":"dir","mtime":"not a date"}');
			expect(parsed).toEqual({ path: '/a', type: 'dir', size: 0, mtime: null, perm: null });
		});

		it('adapts a whole-list reply to the same lines', () => {
			const files = Array.from({ length: 2500 }, (_, i) => ({
				name: `f${i}`,
				path: `/d/f${i}`,
				type: 'file',
				isDirectory: false,
				size: i,
				modifiedAt: MTIME,
				owner: '',
				permissions: '-rw',
				isAvailable: true,
			})) as SnapShotFile[];
			const chunks = [...snapshotFilesToLines(files)];
			const lines = Buffer.concat(chunks).toString().trim().split('\n');
			expect(chunks).toHaveLength(3);
			expect(lines).toHaveLength(2500);
			expect(parseResticLine(lines[2499])).toEqual({
				path: '/d/f2499',
				type: 'file',
				size: 2499,
				mtime: new Date(MTIME).getTime(),
				perm: '-rw',
			});
		});
	});

	describe('writer', () => {
		it('rolls up counts and stores meta', () => {
			const stats = build(tree);
			expect(stats).toEqual({ entries: 10, files: 6, dirs: 4, bytes: 210 });
			const meta = readIndexMeta(file)!;
			expect(meta.stats).toEqual(stats);
			expect(meta.snapshotId).toBe('snap1');
			expect(meta.origin).toBe('remote');

			const { dirs } = listIndexDirs(file, { parent: '/', depth: 1 });
			expect(dirs).toEqual([
				{ path: '/a', subDirs: 2, items: 6, bytes: 100 },
				{ path: '/d', subDirs: 0, items: 1, bytes: 50 },
			]);
		});

		it('keeps the first of two equal paths', () => {
			const stats = build([entry('/x', 'file', 5), entry('/x', 'file', 9)]);
			expect(stats.entries).toBe(1);
			expect(listIndexEntries(file, {}).rows[0].size).toBe(5);
		});

		it('creates missing ancestors', () => {
			const stats = build([entry('/a/b/c.txt', 'file', 5)]);
			expect(stats).toEqual({ entries: 3, files: 1, dirs: 2, bytes: 5 });
			const { rows } = listIndexEntries(file, {});
			expect(rows.map(r => [r.path, r.isDirectory, r.modifiedAt])).toEqual([['/a', true, '']]);
			expect(listIndexDirs(file, { parent: '/a' }).dirs).toEqual([
				{ path: '/a/b', subDirs: 0, items: 1, bytes: 5 },
			]);
		});

		it('stores mtime in the same ms as the compare code', () => {
			const parsed = parseResticLine(`{"path":"/x","type":"file","mtime":"${MTIME}"}`)!;
			build([parsed]);
			const { modifiedAt } = listIndexEntries(file, {}).rows[0];
			expect(new Date(modifiedAt).getTime()).toBe(new Date(MTIME).getTime());
		});

		it('creates a file only the owner can read', () => {
			build(tree);
			if (process.platform !== 'win32') {
				expect(statSync(file).mode & 0o777).toBe(0o600);
			}
		});

		it('fails with SQLITE_FULL and abort removes the file', () => {
			const writer = new SnapshotIndexWriter(file, { backupId: 'b1', origin: 'local' });
			(writer as any).db.pragma('max_page_count = 8');
			let code: string | undefined;
			try {
				for (let i = 0; i < 200000; i++) {
					writer.add(entry(`/dir/name-${i}-${'x'.repeat(100)}`, 'file', 1));
				}
				writer.finish('snap1');
			} catch (error: any) {
				code = error.code;
				writer.abort();
			}
			expect(code).toBe('SQLITE_FULL');
			expect(() => statSync(file)).toThrow();
		});
	});

	describe('reader', () => {
		it('reports a missing file as not ready', () => {
			expect(() => listIndexEntries(file, {})).toThrow(NOT_READY);
			expect(readIndexMeta(file)).toBeNull();
		});

		it('rejects another schema version', () => {
			build(tree);
			const db = new Database(file);
			db.pragma('user_version = 99');
			db.close();
			expect(readIndexMeta(file)).toBeNull();
			expect(() => listIndexEntries(file, {})).toThrow(NOT_READY);
		});

		it('rejects a file that is not a database', () => {
			writeFileSync(file, 'x'.repeat(5000));
			expect(readIndexMeta(file)).toBeNull();
		});

		it('sorts folders first and adds folder data', () => {
			build(tree);
			const { rows, total } = listIndexEntries(file, { dir: '/a' });
			expect(total).toBe(3);
			expect(rows.map(r => r.name)).toEqual(['b', 'c', 'four.txt']);
			expect(rows[0]).toMatchObject({
				path: '/a/b',
				isDirectory: true,
				dirBytes: 30,
				hasSubdirs: false,
				isAvailable: true,
			});
			expect(rows[2].dirBytes).toBeUndefined();
			expect(rows[2].srcPath).toBeUndefined();
		});

		it('sorts by size with folder totals', () => {
			build(tree);
			const { rows } = listIndexEntries(file, { sort: 'size', order: 'desc' });
			expect(rows.map(r => r.name)).toEqual(['a', 'd', 'six.txt']);
		});

		it('sets srcPath for local origin only', () => {
			build([entry('/a.txt')], 'local');
			expect(listIndexEntries(file, {}).rows[0].srcPath).toBeTruthy();
		});

		it('filters by name in one directory and escapes LIKE characters', () => {
			build([entry('/a_b.txt'), entry('/axb.txt'), entry('/d', 'dir'), entry('/d/a_b.txt')]);
			const { rows, total } = listIndexEntries(file, { q: 'a_b' });
			expect(total).toBe(1);
			expect(rows.map(r => r.path)).toEqual(['/a_b.txt']);
		});

		it('pages without loss in a directory with equal names by case', () => {
			build(
				Array.from({ length: 50 }, (_, i) => entry(`/${i % 2 ? 'A' : 'a'}${Math.floor(i / 2)}`))
			);
			const seen: string[] = [];
			for (let offset = 0; offset < 50; offset += 7) {
				seen.push(...listIndexEntries(file, { offset, limit: 7 }).rows.map(r => r.path));
			}
			expect(new Set(seen).size).toBe(50);
		});

		it('returns nothing for an unknown directory', () => {
			build(tree);
			expect(listIndexEntries(file, { dir: '/nope' })).toEqual({ rows: [], total: 0 });
			expect(listIndexDirs(file, { parent: '/nope' })).toEqual({ dirs: [], total: 0 });
		});

		it('reads child dirs to a depth', () => {
			build(tree);
			expect(listIndexDirs(file, { depth: 2 }).dirs.map(d => d.path)).toEqual([
				'/a',
				'/a/b',
				'/a/c',
				'/d',
			]);
			expect(listIndexDirs(file, { depth: 2, offset: 1, limit: 1 })).toMatchObject({
				total: 4,
				dirs: [{ path: '/a/b' }],
			});
		});

		it('caps the page size', () => {
			build(Array.from({ length: 1200 }, (_, i) => entry(`/f${i}`)));
			expect(listIndexEntries(file, { limit: 5000 }).rows).toHaveLength(1000);
		});
	});

	describe('selection', () => {
		const everything = { items: 10, bytes: 210 };

		it('selects all by default', () => {
			build(tree);
			expect(resolveIndexSelection(file, [], [])).toEqual({
				selected: everything,
				total: everything,
				normalized: { includes: [], excludes: [] },
			});
		});

		it('removes an excluded folder with its contents', () => {
			build(tree);
			const result = resolveIndexSelection(file, [], ['/a/b']);
			expect(result.selected).toEqual({ items: 7, bytes: 180 });
			expect(result.normalized).toEqual({ includes: [], excludes: ['/a/b'] });
		});

		it('expands an include under an excluded folder into sibling excludes', () => {
			build(tree);
			const result = resolveIndexSelection(file, ['/a/b/one.txt'], ['/a']);
			expect(result.normalized.includes).toEqual([]);
			expect(result.normalized.excludes.sort()).toEqual([
				'/a/b/two.txt',
				'/a/c',
				'/a/four.txt',
			]);
			expect(result.selected).toEqual({ items: 6, bytes: 120 });
		});

		it('keeps nested rules under nested rules', () => {
			build(tree);
			const result = resolveIndexSelection(file, ['/a/b'], ['/a', '/a/b/one.txt']);
			expect(result.normalized.excludes.sort()).toEqual([
				'/a/b/one.txt',
				'/a/c',
				'/a/four.txt',
			]);
			expect(result.selected).toEqual({ items: 6, bytes: 130 });
		});

		it('drops a rule equal to its parent and unknown paths', () => {
			build(tree);
			const result = resolveIndexSelection(file, ['/a/b'], ['/nope']);
			expect(result.normalized).toEqual({ includes: [], excludes: [] });
		});

		it('uses an include list when root is excluded', () => {
			build(tree);
			const result = resolveIndexSelection(file, ['/a/b/one.txt', '/d'], ['/']);
			expect(result.normalized).toEqual({
				includes: ['/a/b/one.txt', '/d'],
				excludes: [],
			});
			expect(result.selected).toEqual({ items: 5, bytes: 60 });
		});

		it('never returns an empty list for an empty selection', () => {
			build(tree);
			const result = resolveIndexSelection(file, [], ['/']);
			expect(result.selected).toEqual({ items: 0, bytes: 0 });
			expect(result.normalized).toEqual({ includes: [], excludes: ['/'] });
		});

		it('uses the shorter list when one file is kept in a large folder', () => {
			build([entry('/big', 'dir'), ...Array.from({ length: 2500 }, (_, i) => entry(`/big/f${i}`))]);
			const result = resolveIndexSelection(file, ['/big/f1'], ['/big']);
			expect(result.normalized).toEqual({ includes: ['/big/f1'], excludes: [] });
			expect(result.selected).toEqual({ items: 2, bytes: 0 });
		});

		const nested = (outer: number, inner: number) => [
			entry('/big', 'dir'),
			...Array.from({ length: outer }, (_, i) => entry(`/big/f${i}`)),
			entry('/big/keep', 'dir'),
			...Array.from({ length: inner }, (_, i) => entry(`/big/keep/k${i}`)),
		];

		it('caps a selection when both lists are too long', () => {
			build(nested(2500, 2500));
			expect(() =>
				resolveIndexSelection(file, ['/big/keep'], ['/big', '/big/keep/k1'])
			).toThrow(expect.objectContaining({ statusCode: 422, message: 'selection_too_complex' }));
		});

		it('allows an expansion at the cap', () => {
			build(nested(2000, 3000));
			const result = resolveIndexSelection(file, ['/big/keep'], ['/big', '/big/keep/k1']);
			expect(result.normalized.includes).toEqual([]);
			expect(result.normalized.excludes).toHaveLength(2001);
			expect(result.selected).toEqual({ items: 3001, bytes: 0 });
		});
	});

	describe('large data', () => {
		const ENTRIES = 551000;
		const FLAT = 200000;

		it(`builds ${ENTRIES} entries and reads a flat directory at a deep offset`, () => {
			const started = Date.now();
			const writer = new SnapshotIndexWriter(file, { backupId: 'b1', origin: 'remote' });
			for (let i = 0; i < FLAT; i++) {
				writer.add(entry(`/flat/file-${i}.dat`, 'file', i % 4096, 1000 + i, '-rw-r--r--'));
			}
			for (let i = 0; i < ENTRIES - FLAT; i++) {
				const folder = `/var/lib/docker/overlay2/l${i % 500}/d${i % 40000}`;
				writer.add(entry(`${folder}/file-${i}.dat`, 'file', i % 4096, 1000 + i, '-rw-r--r--'));
			}
			const stats = writer.finish('snap1');
			const built = Date.now() - started;

			const queries: Record<string, number> = {};
			const timed = (name: string, run: () => void) => {
				const begin = process.hrtime.bigint();
				run();
				queries[name] = Number(process.hrtime.bigint() - begin) / 1e6;
			};
			let deep: any;
			timed('name asc', () => {
				deep = listIndexEntries(file, { dir: '/flat', offset: 199000, limit: 1000 });
			});
			timed('size desc', () => {
				listIndexEntries(file, { dir: '/flat', sort: 'size', order: 'desc', offset: 199000 });
			});
			timed('selection', () => {
				resolveIndexSelection(file, [], ['/flat', '/var/lib/docker/overlay2/l1']);
			});
			console.log(
				`index ${stats.entries} entries: build ${built} ms, file ${statSync(file).size} bytes, ` +
					`queries ${JSON.stringify(queries)}`
			);

			expect(stats.files).toBe(ENTRIES);
			expect(deep.total).toBe(FLAT);
			expect(deep.rows).toHaveLength(1000);
		}, 180000);
	});
});
