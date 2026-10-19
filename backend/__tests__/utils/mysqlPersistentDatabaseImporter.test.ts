import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import net, { type Socket } from 'net';
import crypto from 'crypto';
import { MysqlPersistentDatabaseImporter } from '../../src/utils/mysqlPersistentDatabaseImporter';
import { frames, send, requestSchema, workerConfigSchema } from '../../src/mysql-worker/protocol';
import { persistentApprovalSchema } from '../../src/utils/persistentRestorePolicy';
import { approval, row } from '../integration/persistentRestore.fixture';

describe('MySQL retained worker: purpose-specific protocol, durable ACK, safe failure', () => {
	let directory: string, file: string, target: any, current: any, store: any, lease: any;
	let server: net.Server | undefined, sockets: Socket[];
	beforeEach(async () => {
		directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mysql-retained-unit-'));
		file = path.join(directory, 'artifact.sql');
		await fs.writeFile(file, 'SELECT 1;\n');
		target = approval();
		target.engine = target.target.engine = 'mysql';
		current = row(target);
		current.artifact = {
			...current.artifact,
			engine: 'mysql',
			bytes: 10,
			sha256: crypto.createHash('sha256').update('SELECT 1;\n').digest('hex'),
			artifactValidation: 'passed',
		};
		lease = null;
		sockets = [];
		store = {
			lease: jest.fn(() => lease),
			addLease: jest.fn(value => {
				lease = value;
			}),
			leaseState: jest.fn((_id, state) => {
				lease = { ...lease, state };
			}),
			removeLease: jest.fn(() => {
				lease = null;
			}),
		};
	});
	afterEach(async () => {
		for (const socket of sockets) socket.destroy();
		if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
		server = undefined;
		await fs.rm(directory, { force: true, recursive: true });
	});
	async function fixture(handler: (socket: Socket) => Promise<void>) {
		server = net.createServer(socket => {
			sockets.push(socket);
			socket.on('error', () => {});
			void handler(socket)
				.then(() => socket.end())
				.catch(() => socket.destroy());
		});
		await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
		const client = new MysqlPersistentDatabaseImporter(store, target, () => true);
		jest.spyOn(client as any, 'socket').mockImplementation(async (signal: AbortSignal) => {
			const socket = net.connect((server!.address() as net.AddressInfo).port, '127.0.0.1');
			sockets.push(socket);
			socket.on('error', () => {});
			signal.addEventListener('abort', () => socket.destroy(), { once: true });
			await new Promise<void>(resolve => socket.once('connect', resolve));
			return socket;
		});
		return client;
	}
	const inspection = () => ({
		engine: 'mysql',
		version: '8.4.11',
		database: 'example_db',
		tables: 1,
		views: 0,
		bytes: 1024,
		observedAt: Date.now(),
		catalogTruncated: false,
		catalog: [{ schema: 'example_db', name: 'fixture_entries', type: 'BASE TABLE' }],
	});
	const expectedLease = (state = 'intended') => ({
		restoreId: current.id,
		targetId: current.targetId,
		database: 'example_db',
		ownerToken: current.ownerToken,
		state,
	});
	const restore = (
		client: MysqlPersistentDatabaseImporter,
		signal = new AbortController().signal
	) => client.restore(current, file, directory, signal, jest.fn());
	async function upload(socket: Socket) {
		const reader = frames(socket);
		const request = requestSchema.parse((await reader.next()).value);
		expect(request.operation).toBe('persistent-import');
		expect(JSON.stringify(request)).not.toContain(file);
		await send(socket, { type: 'ready' });
		expect(Buffer.from(((await reader.next()).value as any).data, 'base64').toString()).toBe(
			'SELECT 1;\n'
		);
		expect((await reader.next()).value).toEqual({ type: 'end' });
		return reader;
	}
	it('supports only MySQL Custom approvals with verify-identity TLS and independent worker activation', () => {
		expect(persistentApprovalSchema.safeParse(target).success).toBe(true);
		for (const patch of [
			{ mode: 'internal' },
			{ target: { ...target.target, engine: 'mariadb' } },
			{ target: { ...target.target, tls: 'local' } },
			{ target: { ...target.target, username: 'root' } },
			{ database: 'mysql' },
		])
			expect(persistentApprovalSchema.safeParse({ ...target, ...patch }).success).toBe(false);
		const config = {
			host: target.target.host,
			port: 3306,
			username: target.target.username,
			databases: ['example_db'],
			maxArtifactBytes: 128 * 1024 ** 2,
		};
		expect(workerConfigSchema.safeParse(config).success).toBe(true);
		expect(
			workerConfigSchema.safeParse({
				...config,
				persistent: {
					targetId: target.id,
					activationId: target.activationId,
					storageId: target.storage.id,
					host: target.target.host,
					port: 3306,
					username: target.target.username,
					database: 'example_db',
					maxArtifactBytes: 128 * 1024 ** 2,
				},
			}).success
		).toBe(true);
		expect(workerConfigSchema.safeParse({ ...config, persistent: true }).success).toBe(false);
	});
	it('ACKs each exact durable transition before accepting a retained result; no automatic cleanup', async () => {
		const client = await fixture(async socket => {
			const reader = await upload(socket);
			for (const state of ['intended', 'created', 'validated']) {
				await send(socket, { type: 'persistent-lease', lease: expectedLease(state) });
				expect((await reader.next()).value).toEqual({ type: 'persistent-ack', state });
				expect(lease.state).toBe(state);
			}
			await send(socket, { type: 'persistent-complete', inspection: inspection() });
		});
		expect((await restore(client)).tables).toBe(1);
		expect(lease.state).toBe('validated');
		expect(store.removeLease).not.toHaveBeenCalled();
	});
	it('private worker cleanup failure after validation never becomes a successful retained result', async () => {
		const client = await fixture(async socket => {
			const reader = await upload(socket);
			for (const state of ['intended', 'created', 'validated']) {
				await send(socket, { type: 'persistent-lease', lease: expectedLease(state) });
				await reader.next();
			}
			await send(socket, {
				type: 'error',
				stage: 'database-cleanup',
				code: 'workspace-cleanup-failed',
			});
		});
		await expect(restore(client)).rejects.toMatchObject({
			code: 'workspace-cleanup-failed',
			stage: 'database-cleanup',
		});
		expect(lease.state).toBe('validated');
		expect(store.removeLease).not.toHaveBeenCalled();
	});
	it.each(['restoreId', 'targetId', 'database', 'ownerToken', 'state'])(
		'does not ACK a foreign/reordered %s',
		async field => {
			const client = await fixture(async socket => {
				await upload(socket);
				await send(socket, {
					type: 'persistent-lease',
					lease: {
						...expectedLease(),
						[field]:
							field === 'state'
								? 'validated'
								: field === 'database'
									? 'foreign_db'
									: 'e'.repeat(field === 'ownerToken' ? 48 : 24),
					},
				});
			});
			await expect(restore(client)).rejects.toMatchObject({ code: 'mysql-worker-protocol-failed' });
			expect(store.addLease).not.toHaveBeenCalled();
		}
	);
	it('a worker zero/success response without all durable transitions cannot mark Ready', async () => {
		const client = await fixture(async socket => {
			await upload(socket);
			await send(socket, { type: 'persistent-complete', inspection: inspection() });
		});
		await expect(restore(client)).rejects.toMatchObject({ code: 'mysql-worker-protocol-failed' });
		expect(lease).toBeNull();
	});
	it('failed durable intent cannot authorize CREATE', async () => {
		store.addLease.mockImplementation(() => {
			throw new Error(target.target.password);
		});
		const client = await fixture(async socket => {
			const reader = await upload(socket);
			await send(socket, { type: 'persistent-lease', lease: expectedLease() });
			expect((await reader.next()).done).toBe(true);
		});
		await expect(restore(client)).rejects.toMatchObject({ code: 'mysql-worker-unavailable' });
		expect(lease).toBeNull();
	});
	it.each([
		'database-tls-failed',
		'database-authentication-failed',
		'restore-purpose-guard-mismatch',
		'database-already-exists',
	])('retains sanitized %s and stage', async code => {
		const client = await fixture(async socket => {
			await frames(socket).next();
			await send(socket, { type: 'error', stage: 'database-target-preflight', code });
		});
		await expect(restore(client)).rejects.toMatchObject({
			code,
			stage: 'database-target-preflight',
		});
		await restore(client).catch(error =>
			expect(error.message).not.toContain(target.target.password)
		);
	});
	it('worker loss is a failure, not cancellation or success, and preserves durable ownership', async () => {
		const client = await fixture(async socket => {
			const reader = await upload(socket);
			await send(socket, { type: 'persistent-lease', lease: expectedLease() });
			await reader.next();
			socket.end();
		});
		await expect(restore(client)).rejects.toMatchObject({ code: 'mysql-worker-unavailable' });
		expect(lease.state).toBe('intended');
	});
	it('explicit cancellation closes IPC and refuses a delayed complete', async () => {
		const controller = new AbortController();
		const client = await fixture(async socket => {
			await upload(socket);
			controller.abort();
		});
		await expect(restore(client, controller.signal)).rejects.toMatchObject({ code: 'cancelled' });
		expect(store.removeLease).not.toHaveBeenCalled();
	});
	it('inspect preserves an existing validated lease; cleanup forgets it only after confirmed owned removal', async () => {
		lease = expectedLease('validated');
		current.artifact.artifactValidation = 'pending';
		const client = await fixture(async socket => {
			const req = requestSchema.parse((await frames(socket).next()).value);
			await send(
				socket,
				req.operation === 'persistent-inspect'
					? { type: 'persistent-complete', inspection: inspection() }
					: { type: 'cleaned' }
			);
		});
		expect((await client.inspect(current, directory, new AbortController().signal)).engine).toBe(
			'mysql'
		);
		expect(lease).not.toBeNull();
		await client.removeOwned(current, directory);
		expect(lease).toBeNull();
		await client.removeOwned(current, directory);
		expect(lease).toBeNull();
	});
	it('unconfigured MySQL never tries a native client', async () => {
		await expect(
			restore(new MysqlPersistentDatabaseImporter(store, target, () => false))
		).rejects.toMatchObject({ code: 'mysql-worker-not-configured' });
		expect(store.addLease).not.toHaveBeenCalled();
	});
	it('cleanup retries a closed transport without dropping ownership, but never retries malformed protocol', async () => {
		lease = expectedLease('validated');
		const client = await fixture(async socket => {
			await frames(socket).next();
			expect(lease).not.toBeNull();
			await send(socket, { type: 'cleaned' });
		});
		const closed = new net.Socket();
		closed.on('error', () => {});
		closed.destroy();
		((client as any).socket as jest.Mock).mockResolvedValueOnce(closed);
		await client.removeOwned(current, directory);
		expect(lease).toBeNull();
		expect((client as any).socket).toHaveBeenCalledTimes(2);
	});
});
