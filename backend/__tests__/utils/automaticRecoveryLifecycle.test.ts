import crypto from 'crypto';
import {
	AutomaticRecoveryLifecycle,
	lifecycleHash,
	isReadonlyRecoveryMount,
} from '../../src/utils/automaticRecoveryLifecycle';
import { fixture, row, approval } from '../integration/persistentRestore.fixture';
import { DatabaseRestoreError } from '../../src/utils/persistentRestorePolicy';
import fs from 'fs/promises';

test('actual child mount must be protected ext4 and read-only, even when a parent bind is read-only', () => {
	const directory = '/run/pluton-automatic-storage/' + 'a'.repeat(24);
	const line = (options: string, target = directory) =>
		`123 40 7:0 / ${target} ${options} shared:12 - ext4 /dev/loop0 rw\n`;
	expect(isReadonlyRecoveryMount(line('ro,nosuid,nodev,noexec,relatime'), directory)).toBe(true);
	expect(isReadonlyRecoveryMount(line('rw,nosuid,nodev,noexec'), directory)).toBe(false);
	expect(
		isReadonlyRecoveryMount(
			line('ro,nosuid,nodev,noexec', '/run/pluton-automatic-storage'),
			directory
		)
	).toBe(false);
	expect(isReadonlyRecoveryMount(line('ro,nosuid,nodev'), directory)).toBe(false);
	expect(
		isReadonlyRecoveryMount(
			line('ro,nosuid,nodev,noexec').replace(' - ext4 ', ' - tmpfs '),
			directory
		)
	).toBe(false);
	expect(isReadonlyRecoveryMount(line('ro,nosuid,nodev,noexec').repeat(2), directory)).toBe(false);
	expect(isReadonlyRecoveryMount('', directory)).toBe(false);
});
describe('automatic lifecycle durable intent, authentication and non-breaking ownership', () => {
	let db: ReturnType<typeof fixture>,
		client: AutomaticRecoveryLifecycle,
		item: ReturnType<typeof row>,
		files: Map<string, Buffer>;
	beforeEach(() => {
		db = fixture();
		item = row(approval());
		item.mode = 'internal';
		item.targetId = item.id;
		db.store.create(item);
		client = new AutomaticRecoveryLifecycle(db.sqlite);
		files = new Map();
		jest.spyOn(client, 'trusted').mockImplementation(async name => {
			if (name === 'capabilities.json')
				return Buffer.from(
					JSON.stringify({
						version: 1,
						engines: ['mariadb', 'postgresql'],
						maxSqlBytes: 128 * 1024 ** 2,
						quotaBytes: 2147483648,
						maxRetentionSeconds: 86400,
						observedAt: Date.now(),
					})
				);
			if (!files.has(name)) throw new Error('private-value-not-exposed');
			return files.get(name)!;
		});
	});
	afterEach(() => {
		jest.restoreAllMocks();
		db.sqlite.close();
	});
	it('accepts explicit MySQL capabilities while retaining the old two-engine operator contract', async () => {
		const original = await client.capability();
		expect(original.available).toBe(true);
		jest.spyOn(client, 'trusted').mockResolvedValue(
			Buffer.from(
				JSON.stringify({
					...original,
					available: undefined,
					engines: ['mariadb', 'postgresql', 'mysql'],
					observedAt: Date.now(),
				})
			)
		);
		expect(await client.capability()).toMatchObject({
			available: true,
			engines: ['mariadb', 'postgresql', 'mysql'],
		});
	});
	const unavailable = () => new DatabaseRestoreError('lifecycle-unavailable');
	it('accepts only fresh closed-schema root capacity, not a browser value or timestamp refresh', async () => {
		const sample = {
			total: 8192 * 1024 ** 2,
			available: 4096 * 1024 ** 2,
			swapUsed: 0,
			cgroupSwap: 0,
			pressure: 0,
			cpuAvailable: 4,
			diskAvailable: 10 * 1024 ** 3,
		};
		files.set(
			'capacity.json',
			Buffer.from(JSON.stringify({ version: 1, observedAt: Date.now(), sample }))
		);
		expect(await client.capacity()).toMatchObject(sample);
		for (const value of [
			null,
			{ ...sample, available: -1 },
			{ ...sample, unexpected: 'not-authority' },
		]) {
			files.set(
				'capacity.json',
				Buffer.from(JSON.stringify({ version: 1, observedAt: Date.now(), sample: value }))
			);
			expect(await client.capacity()).toBeNull();
		}
		for (const observedAt of [Date.now() - 30001, Date.now() + 6000]) {
			files.set('capacity.json', Buffer.from(JSON.stringify({ version: 1, observedAt, sample })));
			expect(await client.capacity()).toBeNull();
		}
	});
	it('commits exact binding BEFORE mailbox access; failures retain durable intent, never re-enroll', async () => {
		jest.spyOn(client, 'capability').mockResolvedValue({ available: false });
		await expect(client.persistent(item, 'provision', false)).rejects.toThrow(
			unavailable().message
		);
		const record = client.record(item.id)!;
		expect(JSON.parse(record.binding)).toMatchObject({
			id: item.id,
			mode: 'persistent',
			snapshotId: item.snapshotId,
		});
		expect(record.owner_token).toBe(item.ownerToken);
		await expect(client.persistent(item, 'provision', false)).rejects.toThrow(
			unavailable().message
		);
		expect(db.sqlite.prepare('SELECT count(*) n FROM automatic_recovery_lifecycle').get()).toEqual({
			n: 1,
		});
	});
	it('rejects altered snapshot/engine/source/digest/owner token and mode', async () => {
		jest.spyOn(client, 'capability').mockResolvedValue({ available: false });
		await client.persistent(item, 'provision', false).catch(() => {});
		for (const changed of [
			{ ...item, snapshotId: 'e'.repeat(64) },
			{ ...item, ownerToken: crypto.randomBytes(24).toString('hex') },
			{ ...item, artifact: { ...item.artifact, sha256: 'f'.repeat(64) } },
			{ ...item, artifact: { ...item.artifact, database: 'other_db' } },
			{ ...item, artifact: { ...item.artifact, engine: 'postgresql' as const } },
		])
			await expect(client.persistent(changed, 'provision', false)).rejects.toThrow(
				'lifecycle-binding-mismatch'
			);
		expect(() =>
			db.sqlite.prepare("UPDATE automatic_recovery_lifecycle SET binding='{}'").run()
		).toThrow('immutable');
	});
	it('reserves only one heavy Internal resource until verified physical removal', async () => {
		jest.spyOn(client, 'capability').mockResolvedValue({ available: false });
		await client.persistent(item, 'provision', false).catch(() => {});
		const second = { ...item, id: 'e'.repeat(24), targetId: 'e'.repeat(24) };
		db.store.create(second);
		await expect(client.persistent(second, 'provision', false)).rejects.toThrow(
			'internal-lifecycle-busy'
		);
	});
	it('refuses parent history deletion/cascade while host resources remain unremoved', async () => {
		jest.spyOn(client, 'capability').mockResolvedValue({ available: false });
		await client.persistent(item, 'provision', false).catch(() => {});
		expect(() =>
			db.sqlite.prepare('DELETE FROM persistent_database_restores WHERE id=?').run(item.id)
		).toThrow('internal lifecycle cleanup required');
		expect(client.record(item.id)?.state).toBe('requested');
	});
	it('durable cancellation survives operator outage and forbids a delayed provision replay', async () => {
		jest.spyOn(client, 'capability').mockResolvedValue({ available: false });
		await client.persistent(item, 'provision', false).catch(() => {});
		await client.persistent(item, 'delete', false).catch(() => {});
		expect(client.record(item.id)?.action).toBe('delete');
		await expect(client.persistent(item, 'provision', false)).rejects.toThrow(
			'lifecycle-deletion-in-progress'
		);
	});
	it('serializes mailbox publication; cancellation supersedes a provision blocked while writing its private temporary file', async () => {
		jest.spyOn(client, 'capability').mockResolvedValue({
			available: true,
			version: 1,
			engines: ['mariadb', 'postgresql'],
			maxSqlBytes: 128 * 1024 ** 2,
			quotaBytes: 2147483648,
			maxRetentionSeconds: 86400,
			observedAt: Date.now(),
		});
		jest.spyOn(fs, 'lstat').mockResolvedValue({
			isDirectory: () => true,
			isSymbolicLink: () => false,
			uid: 10001,
			mode: 0o700,
		} as any);
		let release!: () => void, started!: () => void;
		const blocked = new Promise<void>(resolve => {
			release = resolve;
		});
		const writing = new Promise<void>(resolve => {
			started = resolve;
		});
		const writes: string[] = [];
		jest.spyOn(fs, 'open').mockResolvedValue({
			writeFile: async (text: string) => {
				const action = JSON.parse(text).action;
				writes.push(action);
				if (action === 'provision') {
					started();
					await blocked;
				}
			},
			sync: async () => {},
			close: async () => {},
		} as any);
		const rename = jest.spyOn(fs, 'rename').mockResolvedValue();
		jest.spyOn(fs, 'rm').mockResolvedValue();
		const provision = client.persistent(item, 'provision', false);
		await writing;
		const cancellation = client.persistent(item, 'delete', false);
		release();
		await Promise.all([provision, cancellation]);
		expect(writes).toEqual(['provision', 'delete']);
		expect(rename).toHaveBeenCalledTimes(1); // Only Delete reaches the public mailbox name.
		expect(client.record(item.id)?.action).toBe('delete');
	});
	it('accepts only root-bound receipts; no credential value is in the public diagnostic', async () => {
		jest.spyOn(client, 'capability').mockResolvedValue({ available: false });
		await client.persistent(item, 'provision', false).catch(() => {});
		const stored = client.record(item.id)!;
		const receipt = {
			version: 1,
			id: item.id,
			bindingHash: lifecycleHash(JSON.parse(stored.binding), stored.owner_token),
			state: 'cleanup-required',
			sequence: 1,
			code: 'operator-resource-uncertain',
			observedAt: Date.now(),
		};
		files.set(item.id + '.receipt.json', Buffer.from(JSON.stringify(receipt)));
		expect(await client.receipt(item.id)).toEqual(receipt);
		files.set(
			item.id + '.receipt.json',
			Buffer.from(JSON.stringify({ ...receipt, bindingHash: 'e'.repeat(64) }))
		);
		expect(await client.receipt(item.id)).toBeNull();
		files.set(
			item.id + '.receipt.json',
			Buffer.from(JSON.stringify({ ...receipt, secret: 'not-accepted' }))
		);
		expect(await client.receipt(item.id)).toBeNull();
	});

	it('durable replay preserves authority and mailbox revision; explicit Resume publishes the next sequence', async () => {
		jest
			.spyOn(client, 'capability')
			.mockResolvedValue({ available: true, engines: ['mariadb', 'postgresql'] } as any);
		jest.spyOn(fs, 'lstat').mockResolvedValue({
			isDirectory: () => true,
			isSymbolicLink: () => false,
			uid: 10001,
			mode: 0o700,
		} as any);
		let contents = '';
		const open = jest.spyOn(fs, 'open').mockImplementation(
			async () =>
				({
					stat: async () => ({
						isFile: () => true,
						uid: 10001,
						mode: 0o600,
						nlink: 1,
						size: contents.length,
					}),
					readFile: async () => contents,
					writeFile: async (value: string) => {
						contents = value;
					},
					sync: async () => {},
					close: async () => {},
				}) as any
		);
		const rename = jest.spyOn(fs, 'rename').mockResolvedValue();
		jest.spyOn(fs, 'rm').mockResolvedValue();
		await client.persistent(item, 'resume', false);
		expect(rename).toHaveBeenCalledTimes(1);
		expect(JSON.parse(contents)).toMatchObject({ version: 2, resumeSequence: 1 });
		await client.persistent(item, 'resume', false, true);
		expect(rename).toHaveBeenCalledTimes(1);
		expect(client.record(item.id)?.resume_sequence).toBe(1);
		await client.persistent(item, 'resume', false);
		expect(rename).toHaveBeenCalledTimes(2);
		expect(JSON.parse(contents).resumeSequence).toBe(2);
		open.mockImplementation(async () => {
			throw Object.assign(new Error('unsafe'), { code: 'ELOOP' });
		});
		await expect(client.persistent(item, 'resume', false, true)).rejects.toThrow('unsafe');
		expect(rename).toHaveBeenCalledTimes(2);
	});
	it('incompatible version and stale/forged future heartbeat fail closed', async () => {
		for (const data of [
			{ version: 2 },
			{ observedAt: Date.now() - 60000 },
			{ observedAt: Date.now() + 60000 },
		]) {
			jest.mocked(client.trusted).mockResolvedValue(
				Buffer.from(
					JSON.stringify({
						version: 1,
						engines: ['mariadb', 'postgresql'],
						maxSqlBytes: 128 * 1024 ** 2,
						quotaBytes: 2147483648,
						maxRetentionSeconds: 86400,
						observedAt: Date.now(),
						...data,
					})
				)
			);
			expect((await client.capability()).available).toBe(false);
		}
	});
	it('late lower-sequence receipts cannot overwrite a terminal removed state', async () => {
		jest.spyOn(client, 'capability').mockResolvedValue({ available: false });
		await client.persistent(item, 'provision', false).catch(() => {});
		const record = client.record(item.id)!;
		const receipt = {
			version: 1,
			id: item.id,
			bindingHash: lifecycleHash(JSON.parse(record.binding), record.owner_token),
			state: 'removed',
			sequence: 3,
			code: null,
			observedAt: Date.now(),
		};
		files.set(item.id + '.receipt.json', Buffer.from(JSON.stringify(receipt)));
		expect((await client.receipt(item.id))?.state).toBe('removed');
		files.set(
			item.id + '.receipt.json',
			Buffer.from(JSON.stringify({ ...receipt, state: 'ready', sequence: 2 }))
		);
		expect(await client.receipt(item.id)).toBeNull();
		expect(client.record(item.id)?.state).toBe('removed');
	});
	it('deleted history with an unfinished host receipt remains reconcilable and cannot release capacity from a forged receipt', async () => {
		jest.spyOn(client, 'capability').mockResolvedValue({ available: false });
		await client.persistent(item, 'delete', true).catch(() => {});
		db.store.finishDeleted(item.id);
		expect(db.store.pending().map(row => row.id)).toContain(item.id);
		const record = client.record(item.id)!;
		const receipt = {
			version: 1,
			id: item.id,
			bindingHash: '0'.repeat(64),
			state: 'removed',
			sequence: 3,
			code: null,
			observedAt: Date.now(),
		};
		files.set(item.id + '.receipt.json', Buffer.from(JSON.stringify(receipt)));
		expect(await client.receipt(item.id)).toBeNull();
		expect(db.store.pending().map(row => row.id)).toContain(item.id);
		files.set(
			item.id + '.receipt.json',
			Buffer.from(
				JSON.stringify({
					...receipt,
					bindingHash: lifecycleHash(JSON.parse(record.binding), record.owner_token),
				})
			)
		);
		expect((await client.receipt(item.id))?.state).toBe('removed');
		expect(db.store.pending().map(row => row.id)).not.toContain(item.id);
	});
	it('authenticates root-only files, rejects writable/symlink/hardlinked/oversized inputs and always closes descriptors', async () => {
		jest.mocked(client.trusted).mockRestore();
		const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
		const uid = Object.getOwnPropertyDescriptor(process, 'getuid');
		Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
		Object.defineProperty(process, 'getuid', { value: () => 10001, configurable: true });
		const directory = { isDirectory: () => true, isSymbolicLink: () => false, uid: 0, mode: 0o750 };
		let file = { isFile: () => true, uid: 0, mode: 0o640, size: 20, nlink: 1 };
		const close = jest.fn(async () => {});
		jest.spyOn(fs, 'lstat').mockResolvedValue(directory as any);
		jest.spyOn(fs, 'open').mockResolvedValue({
			stat: async () => file,
			readFile: async () => Buffer.from('{}'),
			close,
		} as any);
		try {
			expect((await client.trusted('capabilities.json')).toString()).toBe('{}');
			for (const patch of [
				{ uid: 10001 },
				{ mode: 0o660 },
				{ mode: 0o644 },
				{ size: 999999 },
				{ nlink: 2 },
			]) {
				file = { isFile: () => true, uid: 0, mode: 0o640, size: 20, nlink: 1, ...patch };
				await expect(client.trusted('capabilities.json')).rejects.toThrow('lifecycle-unsafe');
			}
			expect(close).toHaveBeenCalledTimes(6);
			jest.mocked(fs.lstat).mockResolvedValue({ ...directory, isSymbolicLink: () => true } as any);
			await expect(client.trusted('capabilities.json')).rejects.toThrow('lifecycle-unsafe');
			await expect(client.trusted('../credentials')).rejects.toThrow('lifecycle-unavailable');
		} finally {
			Object.defineProperty(process, 'platform', platform);
			if (uid) Object.defineProperty(process, 'getuid', uid);
			else delete (process as any).getuid;
		}
	});
	it('restart before session binding cleans only a terminal disposable job; no import is retried', async () => {
		const id = 'e'.repeat(24);
		db.sqlite
			.prepare(
				"INSERT INTO recovery_tests(id,plan_id,backup_id,repository_id,snapshot_id,status,trigger,policy,result) VALUES(?,?,?,?,?,'failed','manual','{}',?)"
			)
			.run(
				id,
				item.planId,
				item.backupId,
				item.repositoryId,
				item.snapshotId,
				JSON.stringify({
					databases: [],
					cleanup: { workspace: true, databases: true, infrastructure: false },
				})
			);
		jest.spyOn(client, 'capability').mockResolvedValue({ available: false });
		await client.testing(id, item.snapshotId, [item.artifact], Date.now()).catch(() => {});
		expect(client.record(id)?.mode).toBe('disposable');
		await client.reconcileTesting();
		expect(client.record(id)?.action).toBe('delete');
		const stored = client.record(id)!;
		files.set(
			id + '.receipt.json',
			Buffer.from(
				JSON.stringify({
					version: 1,
					id,
					bindingHash: lifecycleHash(JSON.parse(stored.binding), stored.owner_token),
					state: 'removed',
					sequence: 1,
					code: null,
					observedAt: Date.now(),
				})
			)
		);
		await client.reconcileTesting();
		expect(client.record(id)?.state).toBe('removed');
		const result = JSON.parse(
			(db.sqlite.prepare('SELECT result FROM recovery_tests WHERE id=?').get(id) as any).result
		);
		expect(result.cleanup.infrastructure).toBe(true);
		expect(
			(db.sqlite.prepare('SELECT status FROM recovery_tests WHERE id=?').get(id) as any).status
		).toBe('failed');
	});
});
