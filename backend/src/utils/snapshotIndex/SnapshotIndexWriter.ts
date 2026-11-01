import Database, { type Database as SqliteDatabase, type Statement } from 'better-sqlite3';
import { closeSync, fsyncSync, openSync, rmSync, writeFileSync } from 'fs';
import {
	SnapshotIndexEntry,
	SnapshotIndexOrigin,
	SnapshotIndexSource,
	SnapshotIndexStats,
} from '../../types/snapshotIndex';
import { trimTrailingSlashes } from '../restic/helpers';

export const SNAPSHOT_INDEX_VERSION = 1;

const BATCH_SIZE = 10000;

const SCHEMA = `
CREATE TABLE meta(key TEXT PRIMARY KEY, value) WITHOUT ROWID;
CREATE TABLE dirs(
	id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, parent INTEGER,
	sub_dirs INTEGER NOT NULL,
	items INTEGER NOT NULL,
	bytes INTEGER NOT NULL
);
CREATE INDEX dirs_parent ON dirs(parent);
CREATE TABLE entries(
	dir INTEGER NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL,
	size INTEGER NOT NULL, mtime INTEGER, perm TEXT, child INTEGER,
	PRIMARY KEY(dir, name)
) WITHOUT ROWID;
`;

export interface SnapshotIndexWriterMeta {
	backupId: string;
	replicationId?: string;
	origin: SnapshotIndexOrigin;
}

function parentOf(path: string): string {
	const slash = path.lastIndexOf('/');
	return slash <= 0 ? '/' : path.slice(0, slash);
}

/** Writes one index file. Any throw needs abort(): the file has no journal. */
export class SnapshotIndexWriter {
	private db: SqliteDatabase;
	private insertEntry: Statement;
	private ids = new Map<string, number>();
	// Parallel arrays indexed by dir ID. A parent always has a lower ID than its child.
	private dirPaths: string[] = [''];
	private parents: number[] = [0];
	private subDirs: number[] = [0];
	private items: number[] = [0];
	private bytes: number[] = [0];
	private listed: boolean[] = [false];
	private stats: SnapshotIndexStats = { entries: 0, files: 0, dirs: 0, bytes: 0 };
	private pending = 0;

	constructor(
		private filePath: string,
		private meta: SnapshotIndexWriterMeta
	) {
		// SQLite keeps the mode of a file that exists. The file holds names in plain text.
		writeFileSync(filePath, '', { mode: 0o600 });
		this.db = new Database(filePath);
		this.db.pragma('journal_mode = OFF');
		this.db.pragma('synchronous = OFF');
		this.db.pragma('locking_mode = EXCLUSIVE');
		this.db.pragma('cache_size = -16000');
		this.db.exec(SCHEMA);
		this.insertEntry = this.db.prepare(
			'INSERT OR IGNORE INTO entries(dir, name, type, size, mtime, perm, child) VALUES (?, ?, ?, ?, ?, ?, ?)'
		);
		this.dirId('/');
		this.db.exec('BEGIN');
	}

	private dirId(path: string): number {
		const known = this.ids.get(path);
		if (known) {
			return known;
		}
		const parent = path === '/' ? 0 : this.dirId(parentOf(path));
		const id = this.parents.length;
		this.ids.set(path, id);
		this.dirPaths.push(path);
		this.parents.push(parent);
		this.subDirs.push(0);
		this.items.push(0);
		this.bytes.push(0);
		this.listed.push(false);
		this.subDirs[parent]++;
		return id;
	}

	add(entry: SnapshotIndexEntry) {
		const path = trimTrailingSlashes(entry.path) || '/';
		if (path === '/') {
			return;
		}
		const dir = this.dirId(parentOf(path));
		const isDir = entry.type === 'dir';
		const child = isDir ? this.dirId(path) : null;
		const name = path.slice(path.lastIndexOf('/') + 1);
		const { changes } = this.insertEntry.run(
			dir,
			name,
			entry.type,
			entry.size,
			entry.mtime,
			entry.perm,
			child
		);
		if (!changes) {
			return;
		}
		this.count(dir, isDir, entry.size);
		if (child) {
			this.listed[child] = true;
		}
		if (++this.pending >= BATCH_SIZE) {
			this.db.exec('COMMIT; BEGIN');
			this.pending = 0;
		}
	}

	private count(dir: number, isDir: boolean, size: number) {
		this.stats.entries++;
		this.items[dir]++;
		if (isDir) {
			this.stats.dirs++;
			return;
		}
		this.stats.files++;
		this.stats.bytes += size;
		this.bytes[dir] += size;
	}

	/** Closes and syncs the file. The caller renames it. */
	finish(snapshotId: string, sources: SnapshotIndexSource[] = []): SnapshotIndexStats {
		const lastDir = this.parents.length - 1;
		for (let id = 2; id <= lastDir; id++) {
			if (this.listed[id]) {
				continue;
			}
			const path = this.dirPaths[id];
			const name = path.slice(path.lastIndexOf('/') + 1);
			const { changes } = this.insertEntry.run(this.parents[id], name, 'dir', 0, null, null, id);
			if (changes) {
				this.count(this.parents[id], true, 0);
			}
		}

		const insertDir = this.db.prepare(
			'INSERT INTO dirs(id, path, parent, sub_dirs, items, bytes) VALUES (?, ?, ?, ?, ?, ?)'
		);
		for (let id = lastDir; id >= 1; id--) {
			const parent = this.parents[id];
			this.items[parent] += this.items[id];
			this.bytes[parent] += this.bytes[id];
			insertDir.run(
				id,
				this.dirPaths[id],
				parent || null,
				this.subDirs[id],
				this.items[id],
				this.bytes[id]
			);
		}

		const insertMeta = this.db.prepare('INSERT INTO meta(key, value) VALUES (?, ?)');
		const meta: Record<string, string | number> = {
			backupId: this.meta.backupId,
			replicationId: this.meta.replicationId || '',
			snapshotId,
			origin: this.meta.origin,
			builtAt: Date.now(),
			...this.stats,
			...(sources.length > 0 && { sources: JSON.stringify(sources) }),
		};
		for (const [key, value] of Object.entries(meta)) {
			insertMeta.run(key, value);
		}
		this.db.exec('COMMIT');
		this.db.pragma(`user_version = ${SNAPSHOT_INDEX_VERSION}`);
		this.db.close();

		const fd = openSync(this.filePath, 'r+');
		try {
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}
		return this.stats;
	}

	abort() {
		try {
			this.db.close();
		} catch {}
		rmSync(this.filePath, { force: true });
	}
}
