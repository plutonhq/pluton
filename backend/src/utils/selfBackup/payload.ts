/**
 * Self-backup payload: the tar that goes inside the encrypted blob.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';
import { extract, pack } from 'tar-stream';
import { appPaths } from '../AppPaths';
import { getDrizzleJournalTag } from '../migrations';

export type PlutonEdition = 'core' | 'pro' | 'plus';

export interface PayloadManifest {
	edition: PlutonEdition;
	plutonVersion: string;
	drizzleJournalTag: string | null;
	createdAt: string;
	hostname: string;
	fileList: string[];
	dbPageCount: number;
}

export const MANIFEST_ENTRY = 'manifest.json';
export const DB_ENTRY = 'db/pluton.db';

/**
 * Every entry is optional: pack what exists, skip what doesn't. Several are absent
 * on a given install, and downstream editions write files core never does.
 */
interface PayloadEntry {
	/** Path inside the tar. */
	entry: string;
	/** Resolve the absolute source path at pack time. */
	source: () => string;
	/** Recurse a directory rather than pack a single file. */
	dir?: boolean;
	/** Skip matching basenames when packing a directory. */
	skip?: (relPath: string) => boolean;
}

export const PAYLOAD_SPEC: PayloadEntry[] = [
	{ entry: 'config/rclone.conf', source: () => path.join(appPaths.getConfigDir(), 'rclone.conf') },
	{
		entry: 'config/rclone_global.json',
		source: () => path.join(appPaths.getConfigDir(), 'rclone_global.json'),
	},
	{
		entry: 'config/restic_global.json',
		source: () => path.join(appPaths.getConfigDir(), 'restic_global.json'),
	},
	{
		entry: 'config/device_settings.json',
		source: () => path.join(appPaths.getConfigDir(), 'device_settings.json'),
	},
	{ entry: 'config/config.json', source: () => path.join(appPaths.getConfigDir(), 'config.json') },
	{
		entry: 'config/self_backup_state.json',
		source: () => path.join(appPaths.getConfigDir(), 'self_backup_state.json'),
	},
	{ entry: 'keys.json', source: () => path.join(appPaths.getDataDir(), 'keys.json') },
	{ entry: 'schedules.json', source: () => appPaths.getSchedulesPath() },
	{ entry: '.activated', source: () => path.join(appPaths.getDataDir(), '.activated') },
	{ entry: 'progress', source: () => appPaths.getProgressDir(), dir: true },
	{
		entry: 'sync',
		source: () => appPaths.getSyncDir(),
		dir: true,
		skip: relPath => relPath.endsWith('.lock'),
	},
];

/**
 * Files whose mtime+size decide whether anything actually changed since the last upload.
 */
const FINGERPRINT_EXCLUDED = new Set(['config/self_backup_state.json']);

function fingerprintTargets(): string[] {
	const dbPath = path.join(appPaths.getDbDir(), 'pluton.db');
	return [
		dbPath,
		`${dbPath}-wal`,
		...PAYLOAD_SPEC.filter(e => !e.dir && !FINGERPRINT_EXCLUDED.has(e.entry)).map(e => e.source()),
	];
}

/**
 * sha256 over path|size|mtime of the DB and the config files in the spec.
 * An unchanged fingerprint means the upload can be skipped entirely, with zero API calls.
 */
export function computeFingerprint(): string {
	const hash = createHash('sha256');
	for (const filePath of fingerprintTargets()) {
		try {
			const stat = fs.statSync(filePath);
			hash.update(`${filePath}|${stat.size}|${stat.mtimeMs}\n`);
		} catch {
			// Absent files contribute a stable marker, so creation/deletion still moves the fingerprint.
			hash.update(`${filePath}|absent\n`);
		}
	}
	return hash.digest('hex');
}

function walkDir(root: string, prefix: string, skip?: (relPath: string) => boolean): string[] {
	const out: string[] = [];
	const stack: { abs: string; rel: string }[] = [{ abs: root, rel: '' }];

	while (stack.length > 0) {
		const { abs, rel } = stack.pop()!;
		let dirEntries: fs.Dirent[];
		try {
			dirEntries = fs.readdirSync(abs, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const dirent of dirEntries) {
			const childAbs = path.join(abs, dirent.name);
			const childRel = rel ? `${rel}/${dirent.name}` : dirent.name;
			if (dirent.isDirectory()) {
				stack.push({ abs: childAbs, rel: childRel });
			} else if (dirent.isFile()) {
				const entry = `${prefix}/${childRel}`;
				if (skip?.(entry)) continue;
				out.push(childRel);
			}
		}
	}
	return out;
}

export function buildManifest(
	fileList: string[],
	dbPageCount: number,
	edition: PlutonEdition
): PayloadManifest {
	return {
		edition,
		// The version of whichever repo built this binary. Core and pro ship separate release lines.
		plutonVersion: process.env.APP_VERSION || 'unknown',
		drizzleJournalTag: getDrizzleJournalTag(),
		createdAt: new Date().toISOString(),
		hostname: os.hostname(),
		fileList,
		dbPageCount,
	};
}

/**
 * Pack the DB snapshot plus every present spec entry into a tar buffer.
 * `dbSnapshotPath` must be a VACUUM INTO output, never a raw copy of a live WAL DB.
 */
export async function packPayload(opts: {
	dbSnapshotPath: string;
	edition: PlutonEdition;
	dbPageCount?: number;
}): Promise<Buffer> {
	const tarPack = pack();
	const chunks: Buffer[] = [];
	const collected = new Promise<Buffer>((resolve, reject) => {
		tarPack.on('data', (c: Buffer) => chunks.push(c));
		tarPack.on('end', () => resolve(Buffer.concat(chunks)));
		tarPack.on('error', reject);
	});

	const fileList: string[] = [];

	const addFile = (entryName: string, absPath: string) => {
		const content = fs.readFileSync(absPath);
		tarPack.entry({ name: entryName, mode: 0o600, size: content.length }, content);
		fileList.push(entryName);
	};

	addFile(DB_ENTRY, opts.dbSnapshotPath);

	for (const spec of PAYLOAD_SPEC) {
		let absSource: string;
		try {
			absSource = spec.source();
		} catch {
			continue;
		}
		if (!fs.existsSync(absSource)) continue;

		if (spec.dir) {
			for (const rel of walkDir(absSource, spec.entry, spec.skip)) {
				addFile(`${spec.entry}/${rel}`, path.join(absSource, rel));
			}
		} else {
			addFile(spec.entry, absSource);
		}
	}

	const manifest = buildManifest(fileList, opts.dbPageCount ?? 0, opts.edition);
	const manifestJson = Buffer.from(JSON.stringify(manifest, null, 2));
	tarPack.entry({ name: MANIFEST_ENTRY, mode: 0o600, size: manifestJson.length }, manifestJson);

	tarPack.finalize();
	return collected;
}

/**
 * Reject any entry that would land outside destDir.
 *
 * In the restore path this tar is attacker-supplied: tar-stream will happily write
 * `../../etc/whatever` if asked. Absolute paths, drive letters, and `..` traversal
 * are all refused.
 */
export function assertSafeEntryPath(entryName: string, destDir: string): string {
	const normalized = entryName.replace(/\\/g, '/');

	if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
		throw new Error(`Refusing tar entry with an absolute path: ${entryName}`);
	}

	const resolvedDest = path.resolve(destDir);
	const target = path.resolve(resolvedDest, normalized);
	const rel = path.relative(resolvedDest, target);

	if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
		throw new Error(`Refusing tar entry that escapes the destination: ${entryName}`);
	}

	return target;
}

/** Unpack a payload tar into destDir and return its manifest. */
export async function unpackPayload(tar: Buffer, destDir: string): Promise<PayloadManifest> {
	const extractor = extract();
	let manifest: PayloadManifest | null = null;

	const done = new Promise<void>((resolve, reject) => {
		extractor.on('entry', (header, stream, next) => {
			if (header.type !== 'file') {
				stream.resume();
				stream.on('end', next);
				return;
			}

			let target: string;
			try {
				target = assertSafeEntryPath(header.name, destDir);
			} catch (error) {
				stream.resume();
				extractor.destroy();
				reject(error as Error);
				return;
			}

			const buf: Buffer[] = [];
			stream.on('data', (c: Buffer) => buf.push(c));
			stream.on('error', reject);
			stream.on('end', () => {
				try {
					const content = Buffer.concat(buf);
					if (header.name === MANIFEST_ENTRY) {
						manifest = JSON.parse(content.toString('utf-8')) as PayloadManifest;
					}
					fs.mkdirSync(path.dirname(target), { recursive: true });
					fs.writeFileSync(target, content, { mode: 0o600 });
					next();
				} catch (error) {
					reject(error as Error);
				}
			});
		});
		extractor.on('finish', resolve);
		extractor.on('error', reject);
	});

	extractor.end(tar);
	await done;

	if (!manifest) {
		throw new Error('Payload is missing manifest.json. This is not a valid Pluton backup blob.');
	}
	return manifest;
}
