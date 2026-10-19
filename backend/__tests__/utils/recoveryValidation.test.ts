import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
	recoveryArtifacts,
	validateRecoveryArtifact,
	validateRestoredFiles,
} from '../../src/utils/recoveryValidation';
import { RecoveryWorkspace } from '../../src/utils/recoveryWorkspace';
import { parseRecoveryInput, recoveryTargetSchema } from '../../src/utils/recoveryTestPolicy';
const sql = Buffer.from('synthetic SQL fixture\n');
const artifact = {
	databaseId: 'db_example',
	engine: 'mariadb',
	database: 'example_db',
	path: '/pluton/database/app.sql',
	bytes: sql.length,
	sha256: crypto.createHash('sha256').update(sql).digest('hex'),
};
describe('Phase 6 isolated filesystem / every database artifact boundary', () => {
	let scratch: string;
	let target: string;
	beforeEach(async () => {
		scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'recovery-validation-'));
		target = path.join(scratch, 'files');
		await fs.mkdir(path.join(target, 'pluton/database'), { recursive: true });
		await fs.writeFile(path.join(target, 'pluton/database/app.sql'), sql);
	});
	afterEach(async () => {
		await fs.rm(scratch, { recursive: true, force: true });
	});
	it.each(['mariadb', 'mysql', 'postgresql'])(
		'verifies a %s SQL artifact SHA-256/bytes',
		async engine => {
			const entry = recoveryArtifacts({ databases: [{ ...artifact, engine }] })[0];
			await validateRecoveryArtifact(entry, target, new AbortController().signal);
			expect(entry.artifactValidation).toBe('passed');
			if (process.platform !== 'win32')
				expect((await fs.stat(path.join(target, entry.path.slice(1)))).mode & 0o777).toBe(0o600);
		}
	);
	it('supports multi/mixed metadata and historical single artifact without inventing an engine or ID', () => {
		expect(
			recoveryArtifacts({
				databases: [
					artifact,
					{
						...artifact,
						engine: 'postgresql',
						databaseId: 'db_analytics',
						database: 'analytics',
						path: '/pluton/database/analytics.sql',
					},
				],
			})
		).toHaveLength(2);
		const { path: artifactPath, bytes, sha256 } = artifact;
		expect(
			recoveryArtifacts({ database: { path: artifactPath, bytes, sha256 } })[0]
		).not.toHaveProperty('engine');
		expect(recoveryArtifacts(undefined)).toEqual([]);
	});
	it.each([
		{ path: '/pluton/database/../secret.sql' },
		{ path: '/pluton/database/%2e.sql' },
		{ databaseId: 'unknown' },
		{ sha256: 'invalid' },
		{ bytes: -1 },
	])('rejects malformed completion metadata', patch => {
		expect(() => recoveryArtifacts({ databases: [{ ...artifact, ...patch }] })).toThrow();
	});
	it('rejects duplicate artifact paths / entry identities', () => {
		expect(() => recoveryArtifacts({ databases: [artifact, artifact] })).toThrow();
	});
	it.each([
		['missing', { path: '/pluton/database/missing.sql' }, 'database-artifact-missing'],
		['size', { bytes: sql.length + 1 }, 'database-artifact-size-mismatch'],
		['hash', { sha256: '0'.repeat(64) }, 'database-artifact-hash-mismatch'],
	])('fails closed for %s artifact', async (_title, patch, code) => {
		const entry = recoveryArtifacts({ databases: [{ ...artifact, ...(patch as object) }] })[0];
		await expect(
			validateRecoveryArtifact(entry, target, new AbortController().signal)
		).rejects.toMatchObject({ code });
		expect(entry.artifactValidation).toBe('failed');
	});
	it('counts files/bytes from actual restore, refuses extras and size mismatch', async () => {
		const files = [{ path: artifact.path, type: 'file', size: sql.length }] as any;
		await expect(
			validateRestoredFiles(files, target, new AbortController().signal)
		).resolves.toEqual({ files: 1, bytes: sql.length });
		await fs.writeFile(path.join(target, 'unexpected.txt'), 'extra');
		await expect(
			validateRestoredFiles(files, target, new AbortController().signal)
		).rejects.toMatchObject({ code: 'restored-file-count-mismatch' });
	});
	it('cancellation interrupts hashing and filesystem validation', async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			validateRecoveryArtifact(
				recoveryArtifacts({ databases: [artifact] })[0],
				target,
				controller.signal
			)
		).rejects.toMatchObject({ code: 'cancelled' });
		await expect(validateRestoredFiles([], target, controller.signal)).rejects.toMatchObject({
			code: 'cancelled',
		});
	});
	it('only removes an exact owned workspace; cannot delete broad/user paths', async () => {
		const workspace = new RecoveryWorkspace(path.join(scratch, 'recovery-tests'));
		const id = 'a'.repeat(24);
		const directory = await workspace.create(id);
		await fs.writeFile(path.join(directory, 'files', 'dump.sql'), sql);
		if (process.platform !== 'win32') expect((await fs.stat(directory)).mode & 0o777).toBe(0o700);
		expect(() => workspace.path('../../')).toThrow();
		await workspace.remove(id);
		await expect(fs.lstat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
		expect((await fs.stat(scratch)).isDirectory()).toBe(true);
	});
	(process.platform === 'win32' ? it.skip : it)(
		'refuses symlink artifact/staging escape and does not delete its target',
		async () => {
			await fs.rm(path.join(target, 'pluton/database/app.sql'));
			await fs.symlink(
				path.join(scratch, 'outside.sql'),
				path.join(target, 'pluton/database/app.sql')
			);
			await fs.writeFile(path.join(scratch, 'outside.sql'), sql);
			await expect(
				validateRecoveryArtifact(
					recoveryArtifacts({ databases: [artifact] })[0],
					target,
					new AbortController().signal
				)
			).rejects.toMatchObject({ code: 'database-artifact-missing' });
			await expect(
				validateRestoredFiles(
					[{ path: artifact.path, type: 'file', size: sql.length }] as any,
					target,
					new AbortController().signal
				)
			).rejects.toMatchObject({ code: 'unsupported-snapshot-file' });
		}
	);
	it('requires dedicated confirmation, verified remote TLS, and no arbitrary commands', () => {
		const target = {
			engine: 'postgresql',
			host: 'example.internal',
			port: 5432,
			username: 'recovery_user',
			tls: 'verify-identity',
			enabled: true,
			dedicated: true,
			password: 'synthetic-password',
		};
		expect(() => parseRecoveryInput(recoveryTargetSchema, target)).not.toThrow();
		for (const patch of [
			{ dedicated: false },
			{ tls: 'local' },
			{ host: '--host' },
			{ command: 'sh' },
			{ password: 'synthetic\npassword' },
		])
			expect(() => parseRecoveryInput(recoveryTargetSchema, { ...target, ...patch })).toThrow(
				'Invalid recovery testing configuration.'
			);
	});
});
