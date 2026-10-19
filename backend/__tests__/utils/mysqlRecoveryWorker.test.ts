import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import net, { type Socket } from 'net';
import {
	MysqlRecoveryWorkerClient,
	WorkerRecoveryDatabaseImporter,
} from '../../src/utils/mysqlRecoveryWorkerClient';
import { RecoveryDatabaseImporter } from '../../src/utils/recoveryDatabaseImport';
import {
	frames,
	send,
	requestSchema,
	responseSchema,
	workerConfigSchema,
	FRAME_LIMIT,
	workerFailure,
	refuseBusy,
} from '../../src/mysql-worker/protocol';
import { RecoveryTestError } from '../../src/utils/recoveryValidation';

describe('optional Oracle MySQL worker boundary', () => {
	it('busy refusal drains unread request bytes and closes the connection slot', async () => {
		let accept: Socket | undefined;
		let closed!: () => void;
		const closing = new Promise<void>(resolve => {
			closed = resolve;
		});
		const listener = net.createServer(socket => {
			accept = socket;
			socket.on('error', () => {});
			socket.once('close', closed);
			void refuseBusy(socket);
		});
		await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
		const client = net.connect((listener.address() as net.AddressInfo).port, '127.0.0.1');
		client.on('error', () => {});
		try {
			await new Promise<void>(resolve => client.once('connect', resolve));
			client.write(Buffer.alloc(4096));
			const reply = (await frames(client).next()).value;
			expect(reply).toMatchObject({ type: 'error', code: 'mysql-worker-busy' });
			await closing;
		} finally {
			client.destroy();
			accept?.destroy();
			await new Promise<void>(resolve => listener.close(() => resolve()));
		}
	});
	it('a closed IPC socket is transport failure, not malformed protocol or successful cancellation', async () => {
		const socket = new net.Socket();
		socket.on('error', () => {});
		socket.destroy();
		await expect(send(socket, { type: 'end' })).rejects.toMatchObject({
			code: 'mysql-worker-unavailable',
		});
	});
	it('serializes explicit job-stage cancellation at the active DB stage, not as a protocol failure', () => {
		expect(
			workerFailure(new RecoveryTestError('job', 'cancelled'), 'database-target-preflight')
		).toEqual({ stage: 'database-target-preflight', code: 'cancelled' });
		expect(
			workerFailure(new Error('synthetic private process failure'), 'database-target-preflight')
		).toEqual({ stage: 'database-target-preflight', code: 'mysql-worker-protocol-failed' });
	});
	let scratch: string, input: any, store: any, leases: any[], server: net.Server, sockets: Socket[];
	beforeEach(async () => {
		scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'mysql-worker-unit-'));
		const sql = 'SELECT 1;\n';
		const file = path.join(scratch, 'artifact.sql');
		await fs.writeFile(file, sql);
		leases = [];
		sockets = [];
		input = {
			testId: 'a'.repeat(24),
			targetId: 'b'.repeat(24),
			target: {
				engine: 'mysql',
				host: 'mysql-recovery.example.internal',
				port: 3306,
				username: 'recovery_user',
				password: 'synthetic-worker-fixture',
				tls: 'verify-identity',
				dedicated: true,
				enabled: true,
			},
			entry: {
				engine: 'mysql',
				database: 'example_db',
				path: '/pluton/database/app.sql',
				bytes: Buffer.byteLength(sql),
				sha256: crypto.createHash('sha256').update(sql).digest('hex'),
				artifactValidation: 'passed',
				importValidation: 'pending',
			},
			file,
			directory: scratch,
			allowedDatabases: ['example_db'],
			signal: new AbortController().signal,
			stage: jest.fn(),
		};
		store = {
			leases: jest.fn(async () => leases),
			addLease: jest.fn(async lease => leases.push(lease)),
			removeLease: jest.fn(async id => {
				leases = leases.filter(row => row.id !== id);
			}),
			leaseTarget: jest.fn(async () => input.target),
		};
	});
	afterEach(async () => {
		jest.restoreAllMocks();
		for (const socket of sockets) socket.destroy();
		if (server) await new Promise<void>(resolve => server.close(() => resolve()));
		await fs.rm(scratch, { recursive: true, force: true });
	});
	async function fixture(handler: (socket: Socket) => Promise<void>, internal = false) {
		server = net.createServer(socket => {
			sockets.push(socket);
			socket.on('error', () => {});
			void handler(socket).catch(() => socket.destroy());
		});
		await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
		const client = new MysqlRecoveryWorkerClient(
			store,
			() => true,
			internal ? async id => ({ id, snapshotId: 'e'.repeat(64) }) : undefined
		);
		jest.spyOn(client as any, 'socket').mockImplementation(async (signal: AbortSignal) => {
			const socket = net.connect((server.address() as net.AddressInfo).port, '127.0.0.1');
			sockets.push(socket);
			signal.addEventListener('abort', () => socket.destroy(), { once: true });
			await new Promise<void>(resolve => socket.once('connect', resolve));
			return socket;
		});
		return client;
	}
	const header = () => ({
		version: 1,
		operation: 'import',
		testId: input.testId,
		targetId: input.targetId,
		target: input.target,
		entry: {
			engine: input.entry.engine,
			database: input.entry.database,
			bytes: input.entry.bytes,
			sha256: input.entry.sha256,
		},
		allowedDatabases: input.allowedDatabases,
		leases: [],
	});
	it('strict protocol rejects local TLS, other engines, paths, executable/argv and excessive artifacts', () => {
		expect(requestSchema.safeParse(header()).success).toBe(true);
		for (const change of [
			{ target: { ...input.target, tls: 'local', host: 'localhost' } },
			{ target: { ...input.target, engine: 'mariadb' } },
			{ binary: '/bin/sh' },
			{ args: ['-c', 'true'] },
			{ file: '/data/config' },
			{ entry: { ...header().entry, bytes: 100 * 1024 ** 3 + 1 } },
		])
			expect(requestSchema.safeParse({ ...header(), ...change }).success).toBe(false);
		expect(
			responseSchema.safeParse({
				type: 'error',
				stage: 'database-import',
				code: 'raw secret error',
			}).success
		).toBe(false);
		expect(
			workerConfigSchema.safeParse({
				host: 'recovery.example.internal',
				port: 3306,
				username: 'recovery_user',
				databases: ['example_db'],
				maxArtifactBytes: 1024,
				password: input.target.password,
			}).success
		).toBe(false);
	});
	it('disabled or absent worker fails MySQL explicitly before transfer or lease creation', async () => {
		await expect(
			new MysqlRecoveryWorkerClient(store, () => false).importDatabase(input)
		).rejects.toMatchObject({ code: 'mysql-worker-not-configured' });
		await expect(
			new MysqlRecoveryWorkerClient(store, () => true).importDatabase(input)
		).rejects.toMatchObject({ code: 'mysql-worker-unavailable' });
		expect(store.addLease).not.toHaveBeenCalled();
	});
	it('only MySQL is dispatched remotely; MariaDB/PostgreSQL keep the unchanged local importer', async () => {
		const local = jest
			.spyOn(RecoveryDatabaseImporter.prototype, 'importDatabase')
			.mockResolvedValue();
		const cleanup = jest.spyOn(RecoveryDatabaseImporter.prototype, 'cleanup').mockResolvedValue();
		const importer = new WorkerRecoveryDatabaseImporter(store);
		for (const engine of ['mariadb', 'postgresql']) {
			input.target.engine = engine;
			await importer.importDatabase(input);
			await importer.cleanup({ id: 'local-lease' } as any, scratch);
		}
		expect(local).toHaveBeenCalledTimes(2);
		expect(cleanup).toHaveBeenCalledTimes(2);
	});
	it('streams authorized SQL and durably acknowledges the exact lease before accepting a result', async () => {
		const lease = {
			id: 'c'.repeat(24),
			testId: input.testId,
			targetId: input.targetId,
			database: input.entry.database,
			ownerToken: 'd'.repeat(48),
		};
		const client = await fixture(async socket => {
			const reader = frames(socket);
			expect(requestSchema.parse((await reader.next()).value).operation).toBe('import');
			await send(socket, { type: 'ready' });
			const chunk = (await reader.next()).value as any;
			expect(Buffer.from(chunk.data, 'base64').toString()).toBe('SELECT 1;\n');
			expect((await reader.next()).value).toEqual({ type: 'end' });
			await send(socket, { type: 'stage', stage: 'database-target-preflight' });
			await send(socket, { type: 'lease', lease });
			expect((await reader.next()).value).toEqual({ type: 'lease-ack', id: lease.id });
			expect(store.addLease).toHaveBeenCalledWith(lease);
			await send(socket, { type: 'complete', tables: 1, views: 1 });
		});
		await client.importDatabase(input);
		expect(input.entry.importValidation).toBe('passed');
		expect(leases).toEqual([lease]);
		expect(input.stage).toHaveBeenCalledWith('database-target-preflight');
	});
	it('Internal durable il_ namespacing never mutates the wire ACK and cleanup removes only its original stored ID', async () => {
		input.targetId = 'irt_' + 'b'.repeat(24);
		const lease = {
			id: 'c'.repeat(24),
			testId: input.testId,
			targetId: input.targetId,
			database: input.entry.database,
			ownerToken: 'd'.repeat(48),
		};
		store.addLease.mockImplementation(async (value: any) => {
			value.id = 'il_' + value.id;
			leases.push(value);
		});
		const client = await fixture(async socket => {
			const reader = frames(socket),
				request = requestSchema.parse((await reader.next()).value);
			expect(request).toHaveProperty('internal.id', input.testId);
			if (request.operation === 'cleanup') {
				expect(request.lease.id).toBe(lease.id);
				await send(socket, { type: 'cleaned' });
				return;
			}
			await send(socket, { type: 'ready' });
			await reader.next();
			await reader.next();
			await send(socket, { type: 'lease', lease });
			expect((await reader.next()).value).toEqual({ type: 'lease-ack', id: lease.id });
			expect(leases[0].id).toBe('il_' + lease.id);
			await send(socket, { type: 'complete', tables: 1, views: 0 });
		}, true);
		await client.importDatabase(input);
		await client.cleanup(leases[0]);
		expect(store.removeLease).toHaveBeenCalledWith('il_' + lease.id);
		expect(leases).toEqual([]);
	});
	it('a lease for another target/job/database is never acknowledged', async () => {
		const client = await fixture(async socket => {
			const reader = frames(socket);
			await reader.next();
			await send(socket, { type: 'ready' });
			await reader.next();
			await reader.next();
			await send(socket, {
				type: 'lease',
				lease: {
					id: 'c'.repeat(24),
					testId: input.testId,
					targetId: 'e'.repeat(24),
					database: 'different_db',
					ownerToken: 'd'.repeat(48),
				},
			});
		});
		await expect(client.importDatabase(input)).rejects.toMatchObject({
			code: 'mysql-worker-protocol-failed',
		});
		expect(store.addLease).not.toHaveBeenCalled();
	});
	it('mixed-engine jobs transfer only leases for this MySQL target', async () => {
		leases.push({
			id: 'c'.repeat(24),
			testId: input.testId,
			targetId: 'e'.repeat(24),
			database: 'other_engine_db',
			ownerToken: 'd'.repeat(48),
		});
		const client = await fixture(async socket => {
			const request = requestSchema.parse((await frames(socket).next()).value);
			expect(request.operation).toBe('import');
			if (request.operation === 'import') expect(request.leases).toEqual([]);
			await send(socket, {
				type: 'error',
				stage: 'database-target-preflight',
				code: 'database-authentication-failed',
			});
		});
		await expect(client.importDatabase(input)).rejects.toMatchObject({
			code: 'database-authentication-failed',
		});
		expect(leases).toHaveLength(1);
	});
	it('failed durable lease persistence cannot authorize CREATE or report success', async () => {
		store.addLease.mockRejectedValue(new Error(input.target.password));
		const client = await fixture(async socket => {
			const reader = frames(socket);
			await reader.next();
			await send(socket, { type: 'ready' });
			await reader.next();
			await reader.next();
			await send(socket, {
				type: 'lease',
				lease: {
					id: 'c'.repeat(24),
					testId: input.testId,
					targetId: input.targetId,
					database: input.entry.database,
					ownerToken: 'd'.repeat(48),
				},
			});
			expect((await reader.next()).done).toBe(true);
		});
		await expect(client.importDatabase(input)).rejects.toMatchObject({
			code: 'mysql-worker-unavailable',
		});
		expect(input.entry.importValidation).toBe('failed');
		expect(leases).toEqual([]);
		expect(JSON.stringify(input.entry)).not.toContain(input.target.password);
	});
	it('a busy worker refuses import and does not create a cleanup lease', async () => {
		const client = await fixture(async socket => {
			await frames(socket).next();
			await send(socket, {
				type: 'error',
				stage: 'database-target-preflight',
				code: 'mysql-worker-busy',
			});
		});
		await expect(client.importDatabase(input)).rejects.toMatchObject({ code: 'mysql-worker-busy' });
		expect(store.addLease).not.toHaveBeenCalled();
	});
	it('cancellation closes the active IPC connection; a delayed response cannot mark the import passed', async () => {
		const controller = new AbortController();
		input.signal = controller.signal;
		const client = await fixture(async socket => {
			const reader = frames(socket);
			await reader.next();
			await send(socket, { type: 'ready' });
			await reader.next();
			await reader.next();
			controller.abort();
		});
		await expect(client.importDatabase(input)).rejects.toMatchObject({ code: 'cancelled' });
		expect(input.entry.importValidation).toBe('failed');
	});
	it.each([
		'database-import-timeout',
		'database-authentication-failed',
		'database-tls-failed',
		'recovery-target-unsafe',
		'database-already-exists',
	])('only sanitized %s errors cross IPC', async code => {
		const client = await fixture(async socket => {
			await frames(socket).next();
			await send(socket, { type: 'error', stage: 'database-target-preflight', code });
		});
		await expect(client.importDatabase(input)).rejects.toMatchObject({ code });
		expect(JSON.stringify(input.entry)).not.toContain(input.target.password);
	});
	it('worker restart/lost connection preserves the durable lease for later ownership-token cleanup', async () => {
		const lease = {
			id: 'c'.repeat(24),
			testId: input.testId,
			targetId: input.targetId,
			database: input.entry.database,
			ownerToken: 'd'.repeat(48),
		};
		const client = await fixture(async socket => {
			const reader = frames(socket);
			await reader.next();
			await send(socket, { type: 'ready' });
			await reader.next();
			await reader.next();
			await send(socket, { type: 'lease', lease });
			await reader.next();
			socket.end();
		});
		await expect(client.importDatabase(input)).rejects.toMatchObject({
			code: 'mysql-worker-unavailable',
		});
		expect(leases).toEqual([lease]);
		expect(store.removeLease).not.toHaveBeenCalled();
	});
	it('cleanup removes a lease only after confirmed ownership-checked worker cleanup', async () => {
		const lease = {
			id: 'c'.repeat(24),
			testId: input.testId,
			targetId: input.targetId,
			database: input.entry.database,
			ownerToken: 'd'.repeat(48),
		};
		leases.push(lease);
		const client = await fixture(async socket => {
			const request = requestSchema.parse((await frames(socket).next()).value);
			expect(request.operation).toBe('cleanup');
			await send(socket, { type: 'cleaned' });
		});
		await client.cleanup(lease);
		expect(leases).toEqual([]);
	});
	it('oversized frames fail without parsing sensitive payloads', async () => {
		const client = await fixture(async socket => {
			await frames(socket).next();
			const buffer = Buffer.alloc(4);
			buffer.writeUInt32BE(FRAME_LIMIT + 1);
			socket.write(buffer);
		});
		await expect(client.importDatabase(input)).rejects.toMatchObject({
			code: 'mysql-worker-protocol-failed',
		});
	});
});
