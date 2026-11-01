import Database, { type Database as SqliteDatabase } from 'better-sqlite3';
import {
	SnapshotIndexDir,
	SnapshotIndexDirsQuery,
	SnapshotIndexEntriesQuery,
	SnapshotIndexMeta,
	SnapshotIndexRow,
	SnapshotIndexSelection,
} from '../../types/snapshotIndex';
import { AppError } from '../AppError';
import { trimTrailingSlashes } from '../restic/helpers';
import { resticPathToWindows } from '../restic/helpers';
import { SNAPSHOT_INDEX_VERSION } from './SnapshotIndexWriter';

const MAX_PAGE = 1000;
const MAX_DIR_DEPTH = 3;
const MAX_EXPANDED_PATHS = 2000;

const SORT_FIELDS = {
	name: 'e.name COLLATE NOCASE',
	modifiedAt: 'e.mtime',
	size: 'COALESCE(c.bytes, e.size)',
};

function notReady(): AppError {
	return new AppError(409, 'index_not_ready');
}

function withIndex<T>(file: string, read: (db: SqliteDatabase) => T): T {
	let db: SqliteDatabase;
	try {
		db = new Database(file, { readonly: true, fileMustExist: true });
	} catch {
		throw notReady();
	}
	try {
		let version: unknown;
		try {
			version = db.pragma('user_version', { simple: true });
		} catch {}
		if (version !== SNAPSHOT_INDEX_VERSION) {
			throw notReady();
		}
		return read(db);
	} finally {
		db.close();
	}
}

function loadMeta(db: SqliteDatabase): SnapshotIndexMeta {
	const rows = db.prepare('SELECT key, value FROM meta').all() as { key: string; value: any }[];
	const meta = Object.fromEntries(rows.map(row => [row.key, row.value]));
	return {
		backupId: meta.backupId,
		replicationId: meta.replicationId,
		snapshotId: meta.snapshotId,
		origin: meta.origin,
		builtAt: meta.builtAt,
		stats: { entries: meta.entries, files: meta.files, dirs: meta.dirs, bytes: meta.bytes },
	};
}

export function normalizePath(path?: string): string {
	const trimmed = trimTrailingSlashes(path || '/');
	if (!trimmed) {
		return '/';
	}
	return trimmed.startsWith('/') ? trimmed : '/' + trimmed;
}

export function joinPath(dir: string, name: string): string {
	return dir === '/' ? '/' + name : `${dir}/${name}`;
}

function pageOf(offset: number | undefined, limit: number | undefined) {
	return {
		offset: Math.max(offset || 0, 0),
		limit: Math.min(Math.max(limit || MAX_PAGE, 1), MAX_PAGE),
	};
}

export function sourcePath(path: string): string {
	return process.platform === 'win32' ? resticPathToWindows(path) : path.replace(/\\/g, '/');
}

export function readIndexMeta(file: string): SnapshotIndexMeta | null {
	try {
		return withIndex(file, loadMeta);
	} catch (error: any) {
		if (error?.statusCode === 409) {
			return null;
		}
		throw error;
	}
}

export function listIndexEntries(
	file: string,
	query: SnapshotIndexEntriesQuery
): { rows: SnapshotIndexRow[]; total: number } {
	return withIndex(file, db => {
		const dirPath = normalizePath(query.dir);
		const dir = db.prepare('SELECT id FROM dirs WHERE path = ?').get(dirPath) as
			| { id: number }
			| undefined;
		if (!dir) {
			return { rows: [], total: 0 };
		}
		const isLocal = loadMeta(db).origin === 'local';
		const { offset, limit } = pageOf(query.offset, query.limit);
		const field = SORT_FIELDS[query.sort || 'name'] || SORT_FIELDS.name;
		const direction = query.order === 'desc' ? 'DESC' : 'ASC';
		const params: (number | string)[] = [dir.id];
		let where = 'e.dir = ?';
		if (query.q) {
			where += " AND e.name LIKE ? ESCAPE '\\'";
			params.push(`%${query.q.replace(/[\\%_]/g, '\\$&')}%`);
		}
		const { total } = db
			.prepare(`SELECT COUNT(*) AS total FROM entries e WHERE ${where}`)
			.get(...params) as { total: number };
		const rows = db
			.prepare(
				`SELECT e.name, e.type, e.size, e.mtime, e.perm, c.bytes AS dirBytes, c.sub_dirs AS subDirs
				 FROM entries e LEFT JOIN dirs c ON c.id = e.child
				 WHERE ${where}
				 ORDER BY (e.type = 'dir') DESC, ${field} ${direction}, e.name COLLATE NOCASE, e.name
				 LIMIT ? OFFSET ?`
			)
			.all(...params, limit, offset) as any[];

		return {
			total,
			rows: rows.map(row => {
				const path = joinPath(dirPath, row.name);
				const result: SnapshotIndexRow = {
					name: row.name,
					path,
					type: row.type,
					isDirectory: row.type === 'dir',
					size: row.size,
					modifiedAt: row.mtime === null ? '' : new Date(row.mtime).toISOString(),
					owner: '',
					permissions: row.perm ?? '',
					isAvailable: true,
				};
				if (isLocal) {
					result.srcPath = sourcePath(path);
				}
				if (row.dirBytes !== null) {
					result.dirBytes = row.dirBytes;
					result.hasSubdirs = row.subDirs > 0;
				}
				return result;
			}),
		};
	});
}

export function listIndexDirs(
	file: string,
	query: SnapshotIndexDirsQuery
): { dirs: SnapshotIndexDir[]; total: number } {
	return withIndex(file, db => {
		const parent = db.prepare('SELECT id FROM dirs WHERE path = ?').get(normalizePath(query.parent)) as
			| { id: number }
			| undefined;
		if (!parent) {
			return { dirs: [], total: 0 };
		}
		const { offset, limit } = pageOf(query.offset, query.limit);
		const depth = Math.min(Math.max(query.depth || 1, 1), MAX_DIR_DEPTH);
		const tree = `WITH RECURSIVE tree(id, level) AS (
			SELECT id, 1 FROM dirs WHERE parent = ?
			UNION ALL
			SELECT d.id, t.level + 1 FROM dirs d JOIN tree t ON d.parent = t.id WHERE t.level < ?
		)`;
		const { total } = db
			.prepare(`${tree} SELECT COUNT(*) AS total FROM tree`)
			.get(parent.id, depth) as { total: number };
		const dirs = db
			.prepare(
				`${tree} SELECT d.path, d.sub_dirs AS subDirs, d.items, d.bytes
				 FROM tree t JOIN dirs d ON d.id = t.id
				 ORDER BY d.path COLLATE NOCASE, d.path
				 LIMIT ? OFFSET ?`
			)
			.all(parent.id, depth, limit, offset) as SnapshotIndexDir[];
		return { dirs, total };
	});
}

interface SelectionNode {
	path: string;
	rule?: boolean;
	children: Map<string, SelectionNode>;
}

function addRule(root: SelectionNode, path: string, rule: boolean) {
	let node = root;
	if (path !== '/') {
		for (const segment of path.slice(1).split('/')) {
			let child = node.children.get(segment);
			if (!child) {
				child = { path: joinPath(node.path, segment), children: new Map() };
				node.children.set(segment, child);
			}
			node = child;
		}
	}
	node.rule = rule;
}

/** Removes rules equal to the inherited state. Returns true if the node holds no rule. */
function pruneRules(node: SelectionNode, inherited: boolean): boolean {
	if (node.rule === inherited) {
		delete node.rule;
	}
	const state = node.rule ?? inherited;
	for (const [name, child] of node.children) {
		if (pruneRules(child, state)) {
			node.children.delete(name);
		}
	}
	return node.rule === undefined && node.children.size === 0;
}

/**
 * Nearest rule wins, and root is selected unless '/' is excluded. Restic takes one
 * list only, so a rule inside the opposite state expands into its sibling paths.
 * The result is the include list or the exclude list, whichever is shorter.
 */
export function resolveIndexSelection(
	file: string,
	includes: string[],
	excludes: string[]
): SnapshotIndexSelection {
	return withIndex(file, db => {
		const dirByPath = db.prepare('SELECT id, items, bytes FROM dirs WHERE path = ?');
		const entryByName = db.prepare('SELECT size FROM entries WHERE dir = ? AND name = ?');
		const childNames = db.prepare('SELECT name FROM entries WHERE dir = ? LIMIT ?');

		const subtree = (path: string): { items: number; bytes: number } | null => {
			const dir = dirByPath.get(path) as { items: number; bytes: number } | undefined;
			if (dir) {
				return { items: dir.items + (path === '/' ? 0 : 1), bytes: dir.bytes };
			}
			const slash = path.lastIndexOf('/');
			const parent = dirByPath.get(slash <= 0 ? '/' : path.slice(0, slash)) as
				| { id: number }
				| undefined;
			const entry =
				parent &&
				(entryByName.get(parent.id, path.slice(slash + 1)) as { size: number } | undefined);
			return entry ? { items: 1, bytes: entry.size } : null;
		};

		const root: SelectionNode = { path: '/', children: new Map() };
		for (const [paths, rule] of [
			[includes, true],
			[excludes, false],
		] as const) {
			for (const path of paths.map(normalizePath)) {
				if (subtree(path)) {
					addRule(root, path, rule);
				}
			}
		}

		const rootSelected = root.rule !== false;
		delete root.rule;
		pruneRules(root, rootSelected);

		// Lists the maximal subtrees in one state. Null means too many expanded paths.
		const listPaths = (listedState: boolean): string[] | null => {
			const listed: string[] = [];
			let expanded = 0;
			const walk = (node: SelectionNode, state: boolean): boolean => {
				if (state !== listedState) {
					return [...node.children.values()].every(child => walk(child, child.rule ?? state));
				}
				if (!node.children.size) {
					listed.push(node.path);
					return true;
				}
				const dir = dirByPath.get(node.path) as { id: number };
				const limit = MAX_EXPANDED_PATHS + node.children.size + 1;
				for (const { name } of childNames.all(dir.id, limit) as { name: string }[]) {
					const child = node.children.get(name);
					if (child) {
						if (!walk(child, child.rule ?? state)) {
							return false;
						}
					} else if (++expanded > MAX_EXPANDED_PATHS) {
						return false;
					} else {
						listed.push(joinPath(node.path, name));
					}
				}
				return true;
			};
			return walk(root, rootSelected) ? listed : null;
		};

		// Each path is a restic argument, so the shorter list is the safer one.
		const preferred = listPaths(!rootSelected);
		const other = listPaths(rootSelected);
		if (!preferred && !other) {
			throw new AppError(422, 'selection_too_complex');
		}
		const useOther = !preferred || (!!other && other.length < preferred.length);
		const listed = (useOther ? other : preferred) as string[];
		const listsIncludes = useOther ? rootSelected : !rootSelected;

		const { stats } = loadMeta(db);
		const total = { items: stats.entries, bytes: stats.bytes };
		const removed = { items: 0, bytes: 0 };
		const ancestors = new Set<string>();
		for (const path of listed) {
			const size = subtree(path)!;
			removed.items += size.items;
			removed.bytes += size.bytes;
			for (let i = path.indexOf('/', 1); i > 0; i = path.indexOf('/', i + 1)) {
				ancestors.add(path.slice(0, i));
			}
		}

		if (!listsIncludes) {
			return {
				total,
				selected: { items: total.items - removed.items, bytes: total.bytes - removed.bytes },
				normalized: { includes: [], excludes: listed },
			};
		}
		// An empty include list would restore everything.
		return {
			total,
			selected: { items: removed.items + ancestors.size, bytes: removed.bytes },
			normalized: listed.length
				? { includes: listed, excludes: [] }
				: { includes: [], excludes: ['/'] },
		};
	});
}
