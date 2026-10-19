import fs from 'fs/promises';
import path from 'path';
import {
	AutomaticRecoveryLifecycle,
	LIFECYCLE_REQUESTS,
} from '../../src/utils/automaticRecoveryLifecycle';
import { fixture, row, approval } from '../integration/persistentRestore.fixture';

// Actual root decisions, with no native adapter, database process or Docker access.
const { reconcile, hash } = require('../../../deploy/automatic-recovery/operator.cjs');

describe('durable explicit Resume authority across mailbox and crash boundaries', () => {
	let db: ReturnType<typeof fixture>,
		item: ReturnType<typeof row>,
		client: AutomaticRecoveryLifecycle;
	beforeEach(() => {
		db = fixture();
		item = row(approval());
		item.mode = 'internal';
		item.targetId = item.id;
		db.store.create(item);
		client = new AutomaticRecoveryLifecycle(db.sqlite);
		jest
			.spyOn(client, 'capability')
			.mockResolvedValue({ available: true, engines: ['mariadb', 'postgresql', 'mysql'] } as any);
	});
	afterEach(() => {
		jest.restoreAllMocks();
		db.sqlite.close();
	});

	function mailbox() {
		const files = new Map<string, { raw: string; inode: number }>();
		const events: string[] = [];
		let inode = 0;
		const control = {
			directoryFailure: false,
			fileFailure: false,
			beforeWrite: undefined as undefined | (() => Promise<void>),
		};
		jest.spyOn(fs, 'lstat').mockResolvedValue({
			isDirectory: () => true,
			isSymbolicLink: () => false,
			uid: 10001,
			mode: 0o700,
		} as any);
		jest.spyOn(fs, 'open').mockImplementation(async (name, flags) => {
			const file = String(name);
			if (file === LIFECYCLE_REQUESTS) {
				expect(flags).toBe(
					fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW
				);
				return {
					sync: async () => {
						events.push('directory-sync');
						if (control.directoryFailure) throw new Error('synthetic directory sync failure');
					},
					close: async () => {
						events.push('directory-close');
					},
				} as any;
			}
			if (flags === 'wx') files.set(file, { raw: '', inode: ++inode });
			const entry = files.get(file);
			if (!entry) throw Object.assign(new Error('missing memory mailbox'), { code: 'ENOENT' });
			return {
				stat: async () => ({
					isFile: () => true,
					uid: 10001,
					mode: 0o600,
					nlink: 1,
					size: entry.raw.length,
				}),
				readFile: async () => entry.raw,
				writeFile: async (text: string) => {
					await control.beforeWrite?.();
					entry.raw = text;
					events.push('file-write');
				},
				sync: async () => {
					events.push('file-sync');
					if (control.fileFailure) throw new Error('synthetic file sync failure');
				},
				close: async () => {},
			} as any;
		});
		const rename = jest.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
			files.set(String(to), files.get(String(from))!);
			files.delete(String(from));
			events.push('rename');
		});
		jest.spyOn(fs, 'rm').mockImplementation(async name => {
			files.delete(String(name));
		});
		const name = path.join(LIFECYCLE_REQUESTS, item.id + '.json');
		return { files, name, control, events, rename, read: () => JSON.parse(files.get(name)!.raw) };
	}

	it.each(['mariadb', 'postgresql', 'mysql'])(
		'original RC-01 counterexample: %s reconstruction cannot create a second Start',
		async engine => {
			item.artifact.engine = engine as any;
			const box = mailbox();
			await client.persistent(item, 'resume', false);
			const original = box.files.get(box.name)!;
			const first = box.read();
			let journal: any = {
				bindingHash: hash(first),
				state: 'stopped',
				attempted: true,
				readyOnce: true,
			};
			let running = false,
				starts = 0;
			const io = {
				exists: () => true,
				busy: () => false,
				inspect: () => ({ meta: {}, running }),
				resume: () => {
					running = true;
					starts++;
				},
				publish: () => {},
			};
			const emit = (state: string, patch = {}) => {
				journal = { ...journal, ...patch, state };
			};
			reconcile(first, journal, io, emit, Date.now(), 'old-inode');
			expect(starts).toBe(1);
			expect(journal.consumedResumeSequence).toBe(1);
			running = false;
			reconcile(first, journal, io, emit, Date.now(), 'old-inode');
			expect(journal.state).toBe('stopped');
			box.files.delete(box.name);
			await client.persistent(item, 'resume', false, true);
			expect(box.files.get(box.name)!.raw).toBe(original.raw);
			expect(box.files.get(box.name)!.inode).not.toBe(original.inode);
			reconcile(box.read(), journal, io, emit, Date.now(), 'new-inode');
			expect(starts).toBe(1);
			expect(journal.state).toBe('stopped');
			expect(client.record(item.id)!.resume_sequence).toBe(1);
			// Different/older bytes may be replaced, but reconstruction retains the same authority.
			box.files.set(box.name, { raw: JSON.stringify({ ...first, resumeSequence: 0 }), inode: -1 });
			await client.persistent(item, 'resume', false, true);
			reconcile(box.read(), journal, io, emit, Date.now(), 'replaced-inode');
			expect(starts).toBe(1);
			// Only a new explicit action can authorize a second Start.
			await client.persistent(item, 'resume', false);
			expect(box.read().resumeSequence).toBe(2);
			reconcile(box.read(), journal, io, emit, Date.now(), 'explicit-new-inode');
			expect(starts).toBe(2);
		}
	);

	it('legacy action zero is not upgraded by polling; only a new explicit Resume allocates authority', async () => {
		const box = mailbox();
		await client.persistent(item, 'provision', false);
		db.sqlite.prepare("UPDATE automatic_recovery_lifecycle SET action='resume'").run();
		await expect(client.persistent(item, 'resume', false, true)).rejects.toThrow(
			'lifecycle-resume-explicit-required'
		);
		expect(client.record(item.id)!.resume_sequence).toBe(0);
		expect(box.read().action).toBe('provision');
		await expect(client.action(item.id, 'resume')).rejects.toThrow(
			'lifecycle-resume-explicit-required'
		);
		await client.persistent(item, 'resume', false);
		expect(box.read()).toMatchObject({ version: 2, action: 'resume', resumeSequence: 1 });
	});

	it('commits explicit authority with FULL durability even in a NORMAL connection; exhaustion never wraps', async () => {
		const box = mailbox();
		db.sqlite.pragma('synchronous = NORMAL');
		await client.persistent(item, 'resume', false);
		expect(db.sqlite.pragma('synchronous', { simple: true })).toBe(2);
		expect(box.events).toEqual([
			'file-write',
			'file-sync',
			'rename',
			'directory-sync',
			'directory-close',
		]);
		db.sqlite
			.prepare('UPDATE automatic_recovery_lifecycle SET resume_sequence=?')
			.run(Number.MAX_SAFE_INTEGER);
		await expect(client.persistent(item, 'resume', false)).rejects.toThrow(
			'lifecycle-resume-sequence-invalid'
		);
		expect(client.record(item.id)!.resume_sequence).toBe(Number.MAX_SAFE_INTEGER);
		expect(box.rename).toHaveBeenCalledTimes(1);
	});
	it('Stop, Inspect, provision and background replay preserve the existing Resume counter', async () => {
		const box = mailbox();
		await client.persistent(item, 'resume', false);
		for (const action of ['stop', 'inspect', 'provision'] as const) {
			await client.persistent(item, action, false);
			await client.persistent(item, action, false, true);
			expect(client.record(item.id)!.resume_sequence).toBe(1);
			expect(box.read()).toMatchObject({ version: 1, action });
			expect(box.read()).not.toHaveProperty('resumeSequence');
		}
	});

	it.each(['file', 'directory'])(
		'%s fsync failure retains the durable sequence and replay never allocates another',
		async failure => {
			const box = mailbox();
			box.control.fileFailure = failure === 'file';
			box.control.directoryFailure = failure === 'directory';
			await expect(client.persistent(item, 'resume', false)).rejects.toThrow(
				failure === 'directory' ? 'lifecycle-durability-unavailable' : 'synthetic file sync failure'
			);
			expect(client.record(item.id)).toMatchObject({ action: 'resume', resume_sequence: 1 });
			expect(box.rename).toHaveBeenCalledTimes(failure === 'file' ? 0 : 1);
			if (failure === 'directory') {
				await expect(client.persistent(item, 'resume', false, true)).rejects.toThrow(
					'lifecycle-durability-unavailable'
				);
				expect(box.rename).toHaveBeenCalledTimes(1);
			}
			box.control.fileFailure = box.control.directoryFailure = false;
			await client.persistent(item, 'resume', false, true);
			expect(box.read().resumeSequence).toBe(1);
			expect(client.record(item.id)!.resume_sequence).toBe(1);
		}
	);

	it('does not publish when SQLite cannot establish FULL durability', async () => {
		const box = mailbox();
		jest.spyOn(db.sqlite, 'pragma').mockImplementation(() => 1 as any);
		await expect(client.persistent(item, 'resume', false)).rejects.toThrow(
			'lifecycle-durability-unavailable'
		);
		expect(client.record(item.id)!.resume_sequence).toBe(0);
		expect(box.rename).not.toHaveBeenCalled();
	});

	it('restart after committed intent/publication failure reuses authority instead of minting a new sequence', async () => {
		const box = mailbox();
		jest.mocked(client.capability).mockResolvedValue({ available: false } as any);
		await expect(client.persistent(item, 'resume', false)).rejects.toThrow('lifecycle-unavailable');
		expect(client.record(item.id)!.resume_sequence).toBe(1);
		const restarted = new AutomaticRecoveryLifecycle(db.sqlite);
		jest
			.spyOn(restarted, 'capability')
			.mockResolvedValue({ available: true, engines: ['mariadb'] } as any);
		await restarted.persistent(item, 'resume', false, true);
		expect(box.read().resumeSequence).toBe(1);
		expect(restarted.record(item.id)!.resume_sequence).toBe(1);
	});

	it('queued same-action Resume cannot publish a superseded sequence', async () => {
		const box = mailbox();
		let release!: () => void, entered!: () => void;
		const writing = new Promise<void>(resolve => {
			entered = resolve;
		});
		const blocked = new Promise<void>(resolve => {
			release = resolve;
		});
		box.control.beforeWrite = async () => {
			entered();
			await blocked;
		};
		const first = client.persistent(item, 'resume', false);
		await writing;
		const second = client.persistent(item, 'resume', false);
		expect(client.record(item.id)!.resume_sequence).toBe(2);
		release();
		await Promise.all([first, second]);
		expect(box.rename).toHaveBeenCalledTimes(1);
		expect(box.read().resumeSequence).toBe(2);
	});

	it('concurrent Delete supersedes queued Resume; Stop, Inspect, Delete and replay never advance authority', async () => {
		const box = mailbox();
		let release!: () => void, entered!: () => void;
		const writing = new Promise<void>(resolve => {
			entered = resolve;
		});
		const blocked = new Promise<void>(resolve => {
			release = resolve;
		});
		box.control.beforeWrite = async () => {
			entered();
			await blocked;
		};
		const resume = client.persistent(item, 'resume', false);
		await writing;
		const deletion = client.persistent(item, 'delete', false);
		release();
		await Promise.all([resume, deletion]);
		expect(box.rename).toHaveBeenCalledTimes(1);
		expect(box.read()).toMatchObject({ version: 1, action: 'delete' });
		expect(box.read()).not.toHaveProperty('resumeSequence');
		expect(client.record(item.id)!.resume_sequence).toBe(1);
		await expect(client.persistent(item, 'resume', false, true)).rejects.toThrow(
			'lifecycle-deletion-in-progress'
		);
		await expect(client.persistent(item, 'resume', false)).rejects.toThrow(
			'lifecycle-deletion-in-progress'
		);
		expect(client.record(item.id)!.resume_sequence).toBe(1);
	});
});
