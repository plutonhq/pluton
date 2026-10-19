import crypto from 'crypto';
import { ManagedReplicationExecutor, ManagedReplicationError, type ReplicationSource } from '../../src/utils/restic/ManagedReplicationExecutor';

jest.mock('../../src/utils/binaryPathResolver', () => ({ getBinaryPath: (name: string) => `/synthetic/bin/${name}` }));

const snapshotId = 'a'.repeat(64);
const sourceTree = 'b'.repeat(64);
function fixture() {
	const source: ReplicationSource = { access: { options: { host: 'sftp.example.internal', user: 'fixture', pass: 'synthetic-source-password' }, password: 'synthetic-repository-password', repositoryPath: 'managed/plan-01' }, planId: 'plan-01', backupId: 'backup-01', snapshotId, artifacts: [] };
	const snapshot = { id: snapshotId, tree: sourceTree, tags: ['pluton-plan-plan-01', 'pluton-backup-backup-01'], paths: ['/srv/example-app'] };
	const proof = { repositoryConfigId: 'c'.repeat(64), snapshot };
	const destination = { options: { type: 's3', endpoint: 'https://s3.example.internal', access_key_id: 'synthetic-access', secret_access_key: 'synthetic-secret', no_check_bucket: 'true' }, repositoryPath: 'bucket-01/owned-prefix', environment: { RCLONE_CA_CERT: '/operator/ca.pem' } };
	const executor = new ManagedReplicationExecutor();
	let existing = true;
	let initialized = false;
	const events: string[] = [];
	const command = jest.spyOn(executor as any, 'command').mockImplementation(async (binary: any, args: any, env: any, signal: any, input: any, long: any, stream: any) => {
		if (signal?.aborted) throw new ManagedReplicationError('cancelled');
		if (binary === 'rclone' && args[0] === 'obscure') return 'synthetic_obscured';
		if (binary === 'rclone' && args[0] === 'lsf') return '';
		const sourceRepository = args[args.indexOf('--repo') + 1].startsWith('rclone:source:');
		if (args.includes('cat')) {
			if (!sourceRepository && !existing && !initialized) throw new ManagedReplicationError('repository-unavailable');
			return JSON.stringify({ id: (sourceRepository ? 'c' : 'd').repeat(64) });
		}
		if (args.includes('init')) { events.push('init'); initialized = true; return ''; }
		if (args.includes('copy')) { events.push('copy'); return 'snapshot copied'; }
		if (args.includes('snapshots')) return JSON.stringify([sourceRepository ? snapshot : { ...snapshot, id: 'e'.repeat(64), original: snapshotId }]);
		if (args.includes('dump')) { stream(Buffer.from('SELECT 1;')); return ''; }
		throw new Error('Unexpected synthetic command');
	});
	const beginInitialization = jest.fn(async () => { events.push('durable-init'); });
	const bindRepository = jest.fn(async () => { events.push('durable-bind'); });
	const run = (state: any = { initialization: 'ready', repositoryConfigId: 'd'.repeat(64) }, signal?: AbortSignal) => executor.copy({ source, proof, destination, state, beginInitialization, bindRepository, signal });
	return { executor, source, snapshot, proof, destination, command, events, beginInitialization, bindRepository, run, absent: () => { existing = false; } };
}

describe('Managed replication fixed Restic executor', () => {
	it('copies only the immutable full snapshot and verifies original/tree/tags on destination', async () => {
		const f = fixture(); await expect(f.run()).resolves.toMatchObject({ snapshotId: 'e'.repeat(64), repositoryConfigId: 'd'.repeat(64) });
		const calls = f.command.mock.calls;
		const copy = calls.find(([, args]: any) => args.includes('copy'))!;
		expect(copy[1]).toContain(snapshotId); expect(copy[1]).not.toContain('--tag'); expect(copy[1]).not.toContain('--no-lock');
		expect(copy[2]).toMatchObject({ RESTIC_PASSWORD: 'synthetic-repository-password', RESTIC_FROM_PASSWORD: 'synthetic-repository-password', RCLONE_CONFIG_DESTINATION_SECRET_ACCESS_KEY: 'synthetic-secret', RCLONE_CA_CERT: '/operator/ca.pem', GOMAXPROCS: '2', RCLONE_TRANSFERS: '2' });
		expect(JSON.stringify(calls.map(([, args]) => args))).not.toContain('synthetic-secret');
		expect(calls.some(([, args]: any) => args.includes('unlock') || args.includes('forget') || args.includes('prune') || args.includes('purge'))).toBe(false);
	});
	it('durably declares initialization and identity before copying to an empty prefix', async () => {
		const f = fixture(); f.absent(); await f.run({ initialization: 'uninitialized', repositoryConfigId: null });
		expect(f.events).toEqual(['durable-init', 'init', 'durable-bind', 'copy']);
		expect(f.bindRepository).toHaveBeenCalledWith('d'.repeat(64));
	});
	it('refuses an unknown existing repository without adopting or modifying it', async () => {
		const f = fixture(); await expect(f.run({ initialization: 'uninitialized', repositoryConfigId: null })).rejects.toMatchObject({ code: 'destination-unowned' });
		expect(f.events).toEqual([]); expect(f.bindRepository).not.toHaveBeenCalled();
	});
	it('refuses existing data when the destination config is absent', async () => {
		const f = fixture(); f.absent(); const previous = f.command.getMockImplementation()!;
		f.command.mockImplementation(async (...args: any[]) => args[0] === 'rclone' && args[1][0] === 'lsf' ? 'application-data/' : previous(...args));
		await expect(f.run({ initialization: 'uninitialized', repositoryConfigId: null })).rejects.toMatchObject({ code: 'destination-not-empty' });
		expect(f.events).toEqual([]);
	});
	it.each(['initializing', 'uncertain'])('refuses uncertain %s before any mutation', async initialization => {
		const f = fixture(); await expect(f.run({ initialization, repositoryConfigId: null })).rejects.toMatchObject({ code: 'initialization-uncertain' });
		expect(f.command).not.toHaveBeenCalled();
	});
	it('does not start initialization if the durable pre-mutation write fails', async () => {
		const f = fixture(); f.absent(); f.beginInitialization.mockRejectedValue(new ManagedReplicationError('claim-lost'));
		await expect(f.run({ initialization: 'uninitialized', repositoryConfigId: null })).rejects.toMatchObject({ code: 'claim-lost' });
		expect(f.events).toEqual([]);
	});
	it('does not copy if initialization identity could not be committed', async () => {
		const f = fixture(); f.absent(); f.bindRepository.mockRejectedValue(new ManagedReplicationError('claim-lost'));
		await expect(f.run({ initialization: 'uninitialized', repositoryConfigId: null })).rejects.toMatchObject({ code: 'claim-lost' });
		expect(f.events).toEqual(['durable-init', 'init']);
	});
	it.each(['id', 'tree', 'tags'])('rejects changed source snapshot %s before copy', async changed => {
		const f = fixture();
		if (changed === 'id') f.snapshot.id = 'f'.repeat(64);
		if (changed === 'tree') f.proof.repositoryConfigId = 'f'.repeat(64);
		if (changed === 'tags') f.snapshot.tags.push('pluton-plan-other');
		await expect(f.run()).rejects.toBeInstanceOf(ManagedReplicationError); expect(f.events).toEqual([]);
	});
	it('rejects changed destination repository identity', async () => {
		const f = fixture(); await expect(f.run({ initialization: 'ready', repositoryConfigId: 'f'.repeat(64) })).rejects.toMatchObject({ code: 'destination-binding-changed' });
		expect(f.events).toEqual([]);
	});
	it('verifies full synthetic SQL bytes/checksum from primary and replica', async () => {
		const f = fixture(); const sql = 'SELECT 1;';
		f.source.artifacts = [{ path: '/pluton/database/fixture.sql', bytes: Buffer.byteLength(sql), sha256: crypto.createHash('sha256').update(sql).digest('hex') }];
		await f.run();
		const dumps = f.command.mock.calls.filter(([, args]: any) => args.includes('dump'));
		expect(dumps).toHaveLength(2); expect(dumps[0][1]).toContain(snapshotId); expect(dumps[1][1]).toContain('e'.repeat(64));
	});
	it('refuses a SQL checksum mismatch before destination mutation', async () => {
		const f = fixture(); f.source.artifacts = [{ path: '/pluton/database/fixture.sql', bytes: 9, sha256: '0'.repeat(64) }];
		await expect(f.run()).rejects.toMatchObject({ code: 'artifact-checksum-mismatch' }); expect(f.events).toEqual([]);
	});
	it('never confirms success with an unrelated destination snapshot', async () => {
		const f = fixture(); const previous = f.command.getMockImplementation()!;
		f.command.mockImplementation(async (...args: any[]) => args[1].includes('snapshots') && args[1].includes('rclone:destination:bucket-01/owned-prefix') ? JSON.stringify([{ ...f.snapshot, id: 'e'.repeat(64), original: 'f'.repeat(64) }]) : previous(...args));
		await expect(f.run()).rejects.toMatchObject({ code: 'destination-snapshot-unverified' });
	});
	it('cancels without a copy', async () => {
		const f = fixture(); const controller = new AbortController(); controller.abort();
		await expect(f.run(undefined, controller.signal)).rejects.toMatchObject({ code: 'cancelled' }); expect(f.events).toEqual([]);
	});
});
