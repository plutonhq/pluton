import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import { constants } from 'fs';
import {
	authorizeInternalMysql,
	readInternalProof,
	internalMysqlDirectoryReady,
	assertInternalMysqlCapacity,
} from '../../src/mysql-worker/internal';
import { workerConfigSchema, requestSchema, workerFailure } from '../../src/mysql-worker/protocol';
import { lifecycleHash } from '../../src/utils/automaticRecoveryLifecycle';

describe('worker independently enforces fresh root resource admission', () => {
	const now = Date.now(),
		MiB = 1024 ** 2;
	const capacity = () => ({
		version: 1,
		observedAt: now,
		sample: {
			total: 8192 * MiB,
			available: 4096 * MiB,
			swapUsed: 0,
			cgroupSwap: 0,
			pressure: 0,
			cpuAvailable: 4,
			diskAvailable: 10 * 1024 ** 3,
		},
	});
	test('uses only the bounded root capacity name and allows real headroom, not installed RAM', async () => {
		const value = capacity();
		value.sample.total = 4096 * MiB;
		value.sample.available = 3000 * MiB;
		const read = jest.fn(async () => Buffer.from(JSON.stringify(value)));
		await expect(assertInternalMysqlCapacity(read, now)).resolves.toBeUndefined();
		expect(read).toHaveBeenCalledWith('capacity.json', 2048);
	});
	test.each([
		{ available: 2800 * MiB },
		{ total: 3000 * MiB },
		{ swapUsed: 129 * MiB },
		{ cgroupSwap: 1 },
		{ pressure: 2 },
		{ cpuAvailable: 1 },
		{ diskAvailable: 1024 },
		{ available: null },
		{ command: 'not-authority' },
	])('fails closed without raw diagnostics on %p', async change => {
		const value = capacity();
		Object.assign(value.sample, change);
		await expect(
			assertInternalMysqlCapacity(async () => Buffer.from(JSON.stringify(value)), now)
		).rejects.toMatchObject({ code: 'internal-resources-insufficient' });
	});
	test('stale, future, missing and unreadable measurements cannot become approval', async () => {
		for (const value of [
			{ ...capacity(), observedAt: now - 30001 },
			{ ...capacity(), observedAt: now + 5001 },
			{ ...capacity(), sample: null },
			{ version: 1, observedAt: now, sample: {} },
		])
			await expect(
				assertInternalMysqlCapacity(async () => Buffer.from(JSON.stringify(value)), now)
			).rejects.toMatchObject({ code: 'internal-resources-insufficient' });
		await expect(
			assertInternalMysqlCapacity(async () => {
				throw new Error('sensitive provider message');
			}, now)
		).rejects.not.toThrow('sensitive');
	});
});

describe('Internal Oracle worker independent root authority', () => {
	const now = Date.now(),
		id = 'a'.repeat(24),
		snapshotId = 'b'.repeat(64);
	let proof: any, receipt: any, request: any, ca: Buffer;
	const config = { internal: { enabled: true as const, maxArtifactBytes: 128 * 1024 ** 2 } };
	beforeEach(() => {
		ca = Buffer.from('synthetic certificate bytes');
		const artifact = {
			databaseId: 'db_example',
			database: 'example_db',
			sha256: 'c'.repeat(64),
			bytes: 1024,
		};
		proof = {
			version: 1,
			binding: {
				id,
				mode: 'disposable',
				engine: 'mysql',
				snapshotId,
				artifacts: [artifact],
				createdAt: now - 1000,
				expiresAt: now + 3600000,
			},
			bindingHash: 'd'.repeat(64),
			approval: {
				version: 1,
				id,
				mode: 'internal',
				purpose: 'pluton-phase6-recovery-only',
				activationId: 'e'.repeat(32),
				engine: 'mysql',
				database: 'example_db',
				target: {
					engine: 'mysql',
					host: 'persistent-db-' + id,
					port: 3306,
					username: 'restore_user',
					password: crypto.randomBytes(32).toString('hex'),
					tls: 'verify-identity',
					enabled: true,
					dedicated: true,
				},
				caSha256: crypto.createHash('sha256').update(ca).digest('hex'),
				maxSqlBytes: 128 * 1024 ** 2,
				maxRetentionSeconds: 86400,
				storage: { id: 'f'.repeat(32), kind: 'fixed-ext4', quotaBytes: 2147483648 },
				binding: { restoreId: id, snapshotId, sha256: artifact.sha256 },
				containerId: '1'.repeat(64),
			},
		};
		receipt = {
			version: 1,
			id,
			bindingHash: proof.bindingHash,
			state: 'ready',
			code: null,
			observedAt: now,
			sequence: 1,
		};
		request = {
			version: 1,
			operation: 'import',
			internal: { id, snapshotId },
			target: proof.approval.target,
			testId: id,
			targetId: 'irt_' + '2'.repeat(24),
			entry: {
				databaseId: artifact.databaseId,
				engine: 'mysql',
				database: artifact.database,
				sha256: artifact.sha256,
				bytes: artifact.bytes,
			},
			allowedDatabases: ['example_db'],
			leases: [],
		};
	});
	const read = async (name: string, max: number) => {
		expect(max).toBeLessThanOrEqual(16384);
		if (name === id + '.mysql.json') return Buffer.from(JSON.stringify(proof));
		if (name === id + '.receipt.json') return Buffer.from(JSON.stringify(receipt));
		if (name === id + '-ca.pem') return ca;
		throw new Error('not a root-authorized path');
	};
	it('opts in explicitly without a static endpoint and returns only a root-bound native configuration', async () => {
		expect(workerConfigSchema.parse(config)).toEqual(config);
		const result = await authorizeInternalMysql(
			requestSchema.parse(request) as any,
			config,
			read,
			now
		);
		expect(result.config.host).toBe('persistent-db-' + id);
		expect(result.config.databases).toEqual(['example_db']);
		expect(result.ca).toBe(path.join('/run/pluton-mysql-internal', id + '-ca.pem'));
	});
	for (const [name, change] of [
		[
			'snapshot',
			() => {
				request.internal.snapshotId = '0'.repeat(64);
			},
		],
		[
			'engine',
			() => {
				proof.binding.engine = 'mariadb';
			},
		],
		[
			'digest',
			() => {
				request.entry.sha256 = '0'.repeat(64);
			},
		],
		[
			'database identity',
			() => {
				request.entry.databaseId = 'db_other';
			},
		],
		[
			'bytes',
			() => {
				request.entry.bytes++;
			},
		],
		[
			'endpoint',
			() => {
				request.target = { ...request.target, host: 'source.example.internal' };
			},
		],
		[
			'password',
			() => {
				request.target = { ...request.target, password: crypto.randomBytes(32).toString('hex') };
			},
		],
		[
			'root receipt binding',
			() => {
				receipt.bindingHash = '0'.repeat(64);
			},
		],
		[
			'stale readiness',
			() => {
				receipt.observedAt = now - 31000;
			},
		],
		[
			'future readiness',
			() => {
				receipt.observedAt = now + 6000;
			},
		],
		[
			'stopped resource',
			() => {
				receipt.state = 'stopped';
			},
		],
		[
			'removed resource',
			() => {
				receipt.state = 'removed';
			},
		],
		[
			'storage quota',
			() => {
				proof.approval.storage.quotaBytes = 1024 ** 3;
			},
		],
		[
			'TLS authority',
			() => {
				ca = Buffer.from('different synthetic certificate');
			},
		],
		[
			'database scope',
			() => {
				request.allowedDatabases.push('other_db');
			},
		],
		[
			'expired import',
			() => {
				proof.binding.expiresAt = now - 1;
			},
		],
		[
			'target identity',
			() => {
				request.targetId = '3'.repeat(24);
			},
		],
		[
			'mode isolation',
			() => {
				proof.binding.mode = 'persistent';
			},
		],
		[
			'system database',
			() => {
				request.entry.database = 'mysql';
			},
		],
	] as const)
		it('refuses ' + name + ' mismatch without revealing secrets', async () => {
			change();
			try {
				await authorizeInternalMysql(request, config, read, now);
				throw new Error('must refuse');
			} catch (error) {
				expect(error).toMatchObject({ code: 'target-binding-mismatch' });
				expect(workerFailure(error, 'database-target-preflight')).toEqual({
					stage: 'database-target-preflight',
					code: 'target-binding-mismatch',
				});
				expect(String(error)).not.toContain(proof.approval.target.password);
			}
		});
	it('does not turn a Custom configuration into permission to access Internal', async () => {
		const custom = {
			host: 'custom.example.internal',
			port: 3306,
			username: 'recovery_user',
			databases: ['example_db'],
			maxArtifactBytes: 1024,
		};
		expect(workerConfigSchema.parse(custom)).toEqual(custom);
		await expect(authorizeInternalMysql(request, custom, read, now)).rejects.toMatchObject({
			code: 'target-binding-mismatch',
		});
		for (const value of [
			{},
			{ internal: config.internal, host: 'incomplete.example.internal' },
			{ internal: { ...config.internal, maxArtifactBytes: 128 * 1024 ** 2 + 1 } },
		])
			expect(workerConfigSchema.safeParse(value).success).toBe(false);
	});
	it('allows expired owner cleanup but not import and requires the exact database scope', async () => {
		proof.binding.expiresAt = now - 1;
		const input = {
			version: 1,
			operation: 'cleanup',
			internal: request.internal,
			target: request.target,
			lease: {
				id: '4'.repeat(24),
				testId: id,
				targetId: request.targetId,
				database: 'example_db',
				ownerToken: crypto.randomBytes(24).toString('hex'),
			},
		};
		await expect(authorizeInternalMysql(input as any, config, read, now)).resolves.toHaveProperty(
			'approval'
		);
		input.lease.database = 'other_db';
		await expect(authorizeInternalMysql(input as any, config, read, now)).rejects.toMatchObject({
			code: 'target-binding-mismatch',
		});
	});
	function persistent() {
		proof.binding.mode = 'persistent';
		proof.approval.purpose = 'pluton-persistent-database-restore-v1';
		const ownerToken = crypto.randomBytes(24).toString('hex');
		proof.bindingHash = lifecycleHash(proof.binding, ownerToken);
		receipt.bindingHash = proof.bindingHash;
		return {
			version: 1,
			operation: 'persistent-import',
			internal: request.internal,
			approval: proof.approval,
			lease: null,
			context: {
				id,
				targetId: id,
				purpose: proof.approval.purpose,
				mode: 'internal',
				databaseId: 'db_example',
				ownerToken,
				snapshotId,
				expiresAt: proof.binding.expiresAt,
				cancelRequested: false,
				artifact: { ...request.entry, artifactValidation: 'passed' },
			},
		};
	}
	it('retained authority independently binds the durable owner token, stable database ID and exact snapshot', async () => {
		const input = persistent();
		await expect(authorizeInternalMysql(input as any, config, read, now)).resolves.toHaveProperty(
			'config.persistent.targetId',
			id
		);
		for (const patch of [
			{ ownerToken: crypto.randomBytes(24).toString('hex') },
			{ databaseId: 'db_other' },
			{ snapshotId: '0'.repeat(64) },
			{ targetId: '0'.repeat(24) },
			{ mode: 'custom' },
			{ expiresAt: now + 2000 },
		]) {
			await expect(
				authorizeInternalMysql(
					{ ...input, context: { ...input.context, ...patch } } as any,
					config,
					read,
					now
				)
			).rejects.toMatchObject({ code: 'target-binding-mismatch' });
		}
	});
});

describe('worker root mailbox file boundary', () => {
	const platform = Object.getOwnPropertyDescriptor(process, 'platform')!,
		uid = Object.getOwnPropertyDescriptor(process, 'getuid');
	let handle: any, bytes: Buffer, stat: any, after: any;
	beforeEach(() => {
		Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
		Object.defineProperty(process, 'getuid', { configurable: true, value: () => 10001 });
		bytes = Buffer.from('bounded synthetic proof');
		stat = {
			isFile: () => true,
			uid: 0n,
			mode: 0o100640n,
			nlink: 1n,
			size: BigInt(bytes.length),
			ctimeNs: 1n,
			mtimeNs: 1n,
		};
		after = stat;
		let stats = 0;
		handle = {
			stat: jest.fn(async () => (stats++ ? after : stat)),
			close: jest.fn(async () => {}),
			read: jest.fn(async (buffer: Buffer, offset: number, length: number, position: number) => ({
				bytesRead: bytes.copy(buffer, offset, position, position + length),
			})),
		};
		jest.spyOn(fs, 'lstat').mockResolvedValue({
			isDirectory: () => true,
			isSymbolicLink: () => false,
			uid: 0,
			mode: 0o750,
		} as any);
		jest.spyOn(fs, 'open').mockResolvedValue(handle);
	});
	afterEach(() => {
		jest.restoreAllMocks();
		Object.defineProperty(process, 'platform', platform);
		if (uid) Object.defineProperty(process, 'getuid', uid);
		else delete (process as any).getuid;
	});
	it('bounds actual IO and opens only a protected root no-follow nonblocking regular file', async () => {
		expect(await readInternalProof('a'.repeat(24) + '.mysql.json', 8192)).toEqual(bytes);
		expect(fs.open).toHaveBeenCalledWith(
			expect.any(String),
			constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
		);
		expect(handle.read.mock.calls.every((call: any[]) => call[0].length === 8193)).toBe(true);
		expect(handle.close).toHaveBeenCalledTimes(1);
	});

	it('advertises Internal only with the dedicated read-only root-owned proof directory', async () => {
		jest.mocked(fs.lstat).mockResolvedValue({
			isDirectory: () => true,
			isSymbolicLink: () => false,
			uid: 0,
			gid: 10001,
			mode: 0o750,
		} as any);
		expect(await internalMysqlDirectoryReady()).toBe(true);
		for (const patch of [
			{ uid: 10001 },
			{ gid: 0 },
			{ mode: 0o770 },
			{ isSymbolicLink: () => true },
		]) {
			jest.mocked(fs.lstat).mockResolvedValue({
				isDirectory: () => true,
				isSymbolicLink: () => false,
				uid: 0,
				gid: 10001,
				mode: 0o750,
				...patch,
			} as any);
			expect(await internalMysqlDirectoryReady()).toBe(false);
		}
		jest.mocked(fs.lstat).mockRejectedValue(Object.assign(new Error('absent'), { code: 'ENOENT' }));
		expect(await internalMysqlDirectoryReady()).toBe(false);
	});
	for (const name of ['../escape', 'a.mysql.json', 'a'.repeat(24) + '.key'])
		it('rejects invalid public name ' + name, async () => {
			await expect(readInternalProof(name, 8192)).rejects.toThrow();
			expect(fs.open).not.toHaveBeenCalled();
		});
	for (const [name, change] of [
		[
			'FIFO',
			() => {
				stat.isFile = () => false;
			},
		],
		[
			'non-root owner',
			() => {
				stat.uid = 10001n;
			},
		],
		[
			'world-readable',
			() => {
				stat.mode = 0o100644n;
			},
		],
		[
			'hardlink',
			() => {
				stat.nlink = 2n;
			},
		],
		[
			'oversized declared file',
			() => {
				stat.size = 8193n;
			},
		],
		[
			'growing actual file',
			() => {
				bytes = Buffer.alloc(9000);
				stat.size = 8192n;
			},
		],
		[
			'racing metadata',
			() => {
				after = { ...stat, ctimeNs: 2n };
			},
		],
	] as const)
		it('refuses ' + name + ' and closes its descriptor', async () => {
			change();
			await expect(readInternalProof('a'.repeat(24) + '.mysql.json', 8192)).rejects.toThrow();
			expect(handle.close).toHaveBeenCalledTimes(1);
		});
	it('rejects a writable/symlink parent before opening any proof', async () => {
		jest.mocked(fs.lstat).mockResolvedValue({
			isDirectory: () => true,
			isSymbolicLink: () => true,
			uid: 0,
			mode: 0o777,
		} as any);
		await expect(readInternalProof('a'.repeat(24) + '.mysql.json', 8192)).rejects.toThrow();
		expect(fs.open).not.toHaveBeenCalled();
	});
});
