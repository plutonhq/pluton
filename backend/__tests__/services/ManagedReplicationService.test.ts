import Cryptr from 'cryptr';
import { ManagedReplicationService } from '../../src/services/ManagedReplicationService';
import { ManagedReplicationError } from '../../src/utils/restic/ManagedReplicationExecutor';
import { AppError } from '../../src/utils/AppError';
import { storageRcloneOptions } from '../../src/utils/storageSecurity';

jest.mock('../../src/utils/storageSecurity', () => ({
	isHcpMode: jest.requireActual('../../src/utils/storageSecurity').isHcpMode,
	storageRcloneOptions: jest.fn(() => ({ type: 's3', endpoint: 'https://s3.example.internal', no_check_bucket: 'true', access_key_id: 'synthetic-key', secret_access_key: 'synthetic-secret' })),
	canonicalS3RepositoryIdentity: jest.fn((storage, path) => ({ authority: 'https://s3.example.internal/bucket-01', prefix: path.split('/').slice(1).join('/'), fingerprint: (storage.id === 'mirror-02' ? 'e' : 'd').repeat(64) })),
	trustEnvironment: jest.fn(() => ({ RCLONE_CA_CERT: '/operator/ca.pem' })),
}));

const secret = 'synthetic-replication-test-secret';
const snapshotId = 'a'.repeat(64);
const replica = (id = '01') => ({ replicationId: `replica-${id}`, storageId: `mirror-${id}`, storagePath: `bucket-01/owned-${id}`, storageName: `Mirror ${id}`, storageType: 's3compatible', addedAt: 1 });

function fixture() {
	const plan: any = { id: 'plan-01', sourceId: 'device-01', sourceType: 'device', storageId: 'primary', storagePath: 'managed/plan-01', method: 'backup', settings: { replication: { enabled: true, storages: [replica()] } } };
	const backup: any = { id: 'backup-01', planId: plan.id, sourceId: plan.sourceId, sourceType: 'device', method: 'backup', storageId: plan.storageId, storagePath: plan.storagePath, status: 'completed', inProgress: false, success: true, encryption: true, completionStats: { snapshot_id: snapshotId } };
	const repository = { id: 'repository-01', planId: plan.id, agentId: 'agent-01', storageId: plan.storageId, storagePath: plan.storagePath, initializedAt: new Date(), encryptedPassword: new Cryptr(secret).encrypt('synthetic-repository-password') };
	const rows: any[] = [];
	const destinations = new Map<string, any>();
	const jobs: any = {
		completedBackupCandidates: jest.fn(() => rows.length ? [] : [backup.id]), markInterrupted: jest.fn(),
		listByBackup: jest.fn(() => rows), listRunnable: jest.fn(() => rows.filter(row => row.status === 'pending')),
		reserveDestination: jest.fn(binding => { const row = { ...binding, initState: 'ready', actualRepositoryId: 'c'.repeat(64) }; destinations.set(binding.destinationFingerprint, row); return row; }),
		enqueue: jest.fn(input => { const row = { ...input, status: 'pending', attempts: 0 }; rows.push(row); return row; }),
		claim: jest.fn((id, token) => { const row = rows.find(row => row.id === id); if (!row || rows.some(row => ['running', 'uncertain'].includes(row.status))) return null; Object.assign(row, { status: 'running', ownerToken: token, attempts: row.attempts + 1 }); return row; }),
		getDestination: jest.fn(fp => destinations.get(fp)),
		beginInitialization: jest.fn(() => true), finalizeInitialization: jest.fn(() => true),
		finish: jest.fn((id, token, result) => { const row = rows.find(row => row.id === id); if (row.ownerToken !== token || row.status !== 'running') return false; Object.assign(row, { ...result, lastErrorCode: result.failureCode, verifiedAt: result.status === 'completed' ? Date.now() : null }); return true; }),
		retry: jest.fn(id => { const row = rows.find(row => row.id === id); if (['failed', 'cancelled'].includes(row?.status)) { row.status = 'pending'; return true; } return false; }),
	};
	const backups: any = { getById: jest.fn(() => backup), getAll: jest.fn(() => [backup]), update: jest.fn((id, patch) => { Object.assign(backup, patch); return backup; }) };
	const plans: any = { getById: jest.fn(() => plan), getAll: jest.fn(() => []) };
	const repositories: any = { getByPlanId: jest.fn(() => repository) };
	const agents: any = { getAgentById: jest.fn(() => ({ agentId: 'agent-01', deviceId: 'device-01' })) };
	const storages: any = { getById: jest.fn(id => ({ id, name: 'Mirror', type: 's3compatible', settings: { hcp_mode: true } })) };
	const remote: any = { getSftpRecoveryOptions: jest.fn(() => ({ host: 'sftp.example.internal', user: 'fixture', pass: 'synthetic-pass' })) };
	const proof = { repositoryConfigId: 'b'.repeat(64), snapshot: { id: snapshotId, tree: 'f'.repeat(64), paths: ['/srv/example-app'], tags: ['pluton-plan-plan-01', 'pluton-backup-backup-01'] } };
	const executor: any = { inspectSource: jest.fn(async () => proof), copy: jest.fn(async () => ({ snapshotId: 'e'.repeat(64), repositoryConfigId: 'c'.repeat(64) })) };
	const create = () => new ManagedReplicationService(jobs, backups, plans, repositories, agents, storages, remote, executor, secret);
	return { service: create(), create, plan, backup, repository, rows, jobs, backups, plans, agents, storages, executor, proof, destinations };
}

describe('Managed Agent server replication', () => {
	it.each([undefined, false, 'false'])('refuses managed custom S3 without protected existing-bucket mode (%s)', async hcp_mode => {
		const f = fixture(); f.storages.getById.mockImplementation((id: string) => ({ id, type: 's3compatible', settings: { hcp_mode } }));
		await expect(f.service.validatePlan(f.plan)).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('protected HCP') });
		await f.service.enqueueBackup('backup-01'); expect(f.jobs.enqueue).not.toHaveBeenCalled();
	});
	it('refuses an HCP endpoint disguised as the AWS provider, but admits the ordinary AWS endpoint', async () => {
		const f = fixture(); f.storages.getById.mockImplementation((id: string) => ({ id, type: 's3', settings: {} }));
		await expect(f.service.validatePlan(f.plan)).rejects.toMatchObject({ statusCode: 400 });
		jest.mocked(storageRcloneOptions).mockReturnValueOnce({ type: 's3', endpoint: 'https://s3.us-east-1.amazonaws.com' });
		await expect(f.service.validatePlan(f.plan)).resolves.toBeUndefined();
		jest.mocked(storageRcloneOptions).mockReturnValueOnce({ type: 's3', endpoint: 'https://s3.amazonaws.com.attacker.example' });
		await expect(f.service.validatePlan(f.plan)).rejects.toMatchObject({ statusCode: 400 });
	});
	it.each([0, 1, 2])('accepts %s replicas with zero disabled', async count => {
		const f = fixture(); f.plan.settings.replication = { enabled: count > 0, storages: [replica(), replica('02')].slice(0, count) };
		await expect(f.service.validatePlan(f.plan)).resolves.toBeUndefined();
	});
	it('rejects more than two even when disabled', async () => {
		const f = fixture(); f.plan.settings.replication = { enabled: false, storages: [replica(), replica('02'), replica('03')] };
		await expect(f.service.validatePlan(f.plan)).rejects.toMatchObject({ statusCode: 400 });
	});
	it('rejects zero enabled, duplicate IDs, primary destination and unsupported storage', async () => {
		for (const change of [
			(f: ReturnType<typeof fixture>) => { f.plan.settings.replication.storages = []; },
			(f: ReturnType<typeof fixture>) => { f.plan.settings.replication.storages = [replica(), replica()]; },
			(f: ReturnType<typeof fixture>) => { f.plan.settings.replication.storages[0].storageId = 'primary'; },
			(f: ReturnType<typeof fixture>) => { f.storages.getById.mockReturnValue({ type: 'ftp' }); },
		]) { const f = fixture(); change(f); await expect(f.service.validatePlan(f.plan)).rejects.toMatchObject({ statusCode: 400 }); }
	});
	it('verifies completed source before enqueue and idempotently projects each destination', async () => {
		const f = fixture(); await f.service.enqueueBackup('backup-01'); await f.service.enqueueBackup('backup-01');
		expect(f.rows).toHaveLength(1); expect(f.executor.inspectSource).toHaveBeenCalledTimes(1);
		expect(f.rows[0]).toMatchObject({ sourceSnapshotId: snapshotId, sourceTreeId: 'f'.repeat(64), repositoryId: 'repository-01', agentId: 'agent-01', destinationStoragePath: 'bucket-01/owned-01' });
		expect(JSON.stringify(f.rows)).not.toContain('synthetic-pass'); expect(JSON.stringify(f.rows)).not.toContain('synthetic-key');
	});
	it.each(['pending', 'failed', 'cancelled'])('rejects incomplete/unsuccessful backup %s without copy', async status => {
		const f = fixture(); f.backup.status = status; await f.service.enqueueBackup('backup-01');
		expect(f.jobs.enqueue).not.toHaveBeenCalled(); expect(f.executor.copy).not.toHaveBeenCalled(); expect(f.backup.mirrors[0].status).toBe('failed');
	});
	it.each(['snapshot', 'agent', 'storage', 'path', 'ciphertext'])('rejects source %s mismatch', async field => {
		const f = fixture();
		if (field === 'snapshot') f.backup.completionStats.snapshot_id = 'abcd1234';
		if (field === 'agent') f.agents.getAgentById.mockReturnValue({ deviceId: 'other-device' });
		if (field === 'storage') f.backup.storageId = 'other-storage';
		if (field === 'path') f.repository.storagePath = 'other/path';
		if (field === 'ciphertext') f.repository.encryptedPassword = 'invalid-ciphertext';
		await f.service.enqueueBackup('backup-01'); expect(f.jobs.enqueue).not.toHaveBeenCalled(); expect(f.backup.mirrors[0].status).toBe('failed');
	});
	it('keeps primary SUCCESS when one replica fails and a second succeeds', async () => {
		const f = fixture(); f.plan.settings.replication.storages.push(replica('02'));
		f.executor.copy.mockRejectedValueOnce(new ManagedReplicationError('repository-locked'));
		await f.service.enqueueBackup('backup-01'); await f.service.tick();
		expect(f.backup).toMatchObject({ status: 'completed', success: true });
		expect(f.backup.mirrors.map((mirror: any) => mirror.status)).toEqual(['failed', 'completed']);
		expect(f.rows[1].destinationSnapshotId).toBe('e'.repeat(64));
	});
	it('retains a second destination admission failure beside durable state and supports explicit recovery', async () => {
		const f = fixture(); f.plan.settings.replication.storages.push(replica('02'));
		const reserve = f.jobs.reserveDestination.getMockImplementation();
		f.jobs.reserveDestination.mockImplementation((input: any) => { if (input.replicationId === 'replica-02') throw new AppError(409, 'synthetic private details'); return reserve(input); });
		await f.service.enqueueBackup('backup-01');
		expect(f.backup.mirrors).toEqual(expect.arrayContaining([expect.objectContaining({ replicationId: 'replica-02', status: 'failed', lastErrorCode: 'admission-409' })]));
		await f.service.tick(); expect(f.backup.mirrors.map((mirror: any) => mirror.status)).toEqual(['completed', 'failed']);
		expect(JSON.stringify(f.backup.mirrors)).not.toContain('private details');
		f.jobs.reserveDestination.mockImplementation(reserve);
		await f.service.retryFailed('backup-01', 'replica-02'); await f.service.tick();
		expect(f.rows).toHaveLength(2); expect(f.backup.mirrors.map((mirror: any) => mirror.status)).toEqual(['completed', 'completed']);
	});
	it('rejects parallel managed execution rather than pretending the shared slot is concurrent', async () => {
		const f = fixture(); f.plan.settings.replication.concurrent = true;
		await expect(f.service.validatePlan(f.plan)).rejects.toMatchObject({ statusCode: 400 });
	});
	it('reconstructs pending work after process restart without a second enqueue or completed copy', async () => {
		const f = fixture(); await f.service.enqueueBackup('backup-01');
		await f.create().rescanCompleted(); await f.create().tick(); await f.create().tick();
		expect(f.jobs.enqueue).toHaveBeenCalledTimes(1); expect(f.executor.copy).toHaveBeenCalledTimes(1);
	});
	it('refuses stale repository or completion metadata before any copy', async () => {
		const f = fixture(); await f.service.enqueueBackup('backup-01'); f.backup.completionStats.sourcePaths = ['/srv/changed'];
		await f.service.tick(); expect(f.executor.copy).not.toHaveBeenCalled(); expect(f.rows[0].lastErrorCode).toBe('source-binding-changed');
	});
	it('retains uncertain initialization and never automatically retries it', async () => {
		const f = fixture(); await f.service.enqueueBackup('backup-01');
		f.executor.copy.mockImplementation(async () => { f.destinations.get('d'.repeat(64)).initState = 'initializing'; throw new ManagedReplicationError('timeout'); });
		await f.service.tick(); expect(f.rows[0].status).toBe('uncertain');
		await expect(f.service.retryFailed('backup-01')).rejects.toMatchObject({ statusCode: 409 });
		await f.service.tick(); expect(f.executor.copy).toHaveBeenCalledTimes(1);
	});
	it('explicit retry verifies again and can recover a partial copy safely', async () => {
		const f = fixture(); f.executor.copy.mockRejectedValueOnce(new ManagedReplicationError('timeout'));
		await f.service.enqueueBackup('backup-01'); await f.service.tick();
		await f.service.retryFailed('backup-01'); await f.service.tick();
		expect(f.rows[0]).toMatchObject({ status: 'completed', attempts: 2 });
	});
	it('keeps uncertain child termination fenced even when the operation timed out', async () => {
		const f = fixture(); await f.service.enqueueBackup('backup-01');
		jest.useFakeTimers();
		try {
			let started!: () => void;
			const copying = new Promise<void>(resolve => { started = resolve; });
			f.executor.copy.mockImplementation(async ({ signal }: { signal: AbortSignal }) => {
				started();
				await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
				throw new ManagedReplicationError('execution-uncertain');
			});
			const tick = f.service.tick(); await copying;
			await jest.advanceTimersByTimeAsync(30 * 60_000); await tick;
			expect(f.rows[0]).toMatchObject({ status: 'uncertain', lastErrorCode: 'execution-uncertain' });
			await expect(f.service.retryFailed('backup-01')).rejects.toMatchObject({ statusCode: 409 });
			await f.service.tick(); expect(f.executor.copy).toHaveBeenCalledTimes(1);
		} finally { jest.useRealTimers(); }
	});
	it('rejects cross-plan alias overlap before reserving a destination', async () => {
		const f = fixture(); f.plans.getAll.mockReturnValue([{ id: 'other-plan', storageId: 'mirror-01', storagePath: 'bucket-01/owned-01/child', settings: {} }]);
		await expect(f.service.validatePlan(f.plan)).rejects.toMatchObject({ statusCode: 409 });
	});
	it('requires completed SQL metadata before an artifact-bearing plan is replicated', async () => {
		const f = fixture(); f.plan.settings.remoteLifecycle = { version: 1, database: { engine: 'mysql', host: 'localhost', port: 3306, tls: 'local', database: 'fixture', username: 'fixture', dumpFilename: 'fixture.sql', timeoutSeconds: 30, maxDumpBytes: 1024, includeRoutines: false, includeEvents: false } };
		await f.service.enqueueBackup('backup-01'); expect(f.jobs.enqueue).not.toHaveBeenCalled();
	});
	it('shutdown cancels and waits for source admission before resolving', async () => {
		const f = fixture(); let admitted: (() => void) | undefined;
		const started = new Promise<void>(resolve => { admitted = resolve; });
		f.executor.inspectSource.mockImplementation(async (_source: unknown, signal: AbortSignal) => {
			admitted!();
			await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
			throw new ManagedReplicationError('cancelled');
		});
		const admission = f.service.enqueueBackup('backup-01'); await started;
		await f.service.shutdown(); await admission;
		expect(f.jobs.enqueue).not.toHaveBeenCalled();
		await f.service.enqueueBackup('backup-01'); expect(f.executor.inspectSource).toHaveBeenCalledTimes(1);
	});
});
