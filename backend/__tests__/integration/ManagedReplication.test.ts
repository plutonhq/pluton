import Cryptr from 'cryptr';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { fixture } from './persistentRestore.fixture';
import { ManagedReplicationService } from '../../src/services/ManagedReplicationService';
import { ManagedReplicationStore } from '../../src/stores/ManagedReplicationStore';
import { PlanStore } from '../../src/stores/PlanStore';
import { BackupStore } from '../../src/stores/BackupStore';
import { RemoteManagedRepositoryStore } from '../../src/stores/RemoteManagedRepositoryStore';
import { AgentStore } from '../../src/stores/AgentStore';
import { StorageStore } from '../../src/stores/StorageStore';
import { PlanService } from '../../src/services/PlanService';
import * as planSchema from '../../src/db/schema/plans';
import * as backupSchema from '../../src/db/schema/backups';
import * as storageSchema from '../../src/db/schema/storages';
import * as deviceSchema from '../../src/db/schema/devices';
import * as restoreSchema from '../../src/db/schema/restores';
import * as agentSchema from '../../src/db/schema/agents';
import * as repositorySchema from '../../src/db/schema/remoteManagedRepositories';

jest.mock('../../src/utils/storageSecurity', () => ({
	...jest.requireActual('../../src/utils/storageSecurity'),
	isHcpMode: jest.requireActual('../../src/utils/storageSecurity').isHcpMode,
	storageRcloneOptions: jest.fn(() => ({ type: 's3', endpoint: 'https://s3.example.internal', no_check_bucket: 'true', access_key_id: 'synthetic-access', secret_access_key: 'synthetic-secret' })),
	canonicalS3RepositoryIdentity: jest.fn(() => ({ authority: 'https://s3.example.internal/bucket-01', prefix: 'managed/fixture', fingerprint: 'a'.repeat(64) })),
	trustEnvironment: jest.fn(() => ({})),
}));

describe('managed replication service with actual migrated SQLite stores', () => {
	it('survives service restart, fences source deletion and commits only exact verified completion', async () => {
		const context = fixture();
		try {
			const secret = 'synthetic-service-integration-secret';
			const settings = { encryption: true, replication: { enabled: true, concurrent: false, storages: [{ replicationId: 'replica-01', storageId: 'mirror-01', storageName: 'Fixture mirror', storageType: 's3compatible', storagePath: 'bucket-01/managed/fixture', addedAt: 1 }] } };
			context.sqlite.exec("INSERT INTO storages(id,name,type,settings) VALUES('mirror-01','Fixture mirror','s3compatible','{\"hcp_mode\":true}'); UPDATE plans SET storage_path='managed/fixture'; UPDATE backups SET encryption=1;");
			context.sqlite.prepare('UPDATE plans SET settings=?').run(JSON.stringify(settings));
			context.sqlite.prepare('UPDATE remote_managed_repositories SET encrypted_password=?').run(new Cryptr(secret).encrypt('synthetic-repository-password'));
			const db = drizzle(context.sqlite, { schema: { ...planSchema, ...backupSchema, ...storageSchema, ...deviceSchema, ...restoreSchema, ...agentSchema, ...repositorySchema } }) as any;
			const store = new ManagedReplicationStore(context.sqlite);
			const backups = new BackupStore(db);
			const executor: any = {
				inspectSource: jest.fn(async () => ({ repositoryConfigId: 'c'.repeat(64), snapshot: { id: 'b'.repeat(64), tree: 'd'.repeat(64), paths: ['/srv/example-app'], tags: ['pluton-plan-plan-01', 'pluton-backup-backup-01'] } })),
				copy: jest.fn(async (input: any) => { await input.beginInitialization(); await input.bindRepository('e'.repeat(64)); return { snapshotId: 'f'.repeat(64), repositoryConfigId: 'e'.repeat(64) }; }),
			};
			const create = () => new ManagedReplicationService(store, backups, new PlanStore(db), new RemoteManagedRepositoryStore(db), new AgentStore(db), new StorageStore(db), { getSftpRecoveryOptions: async () => ({ host: 'sftp.example.internal', user: 'fixture', pass: 'synthetic-pass' }) }, executor, secret);
			await create().rescanCompleted();
			expect(store.listByBackup('backup-01')[0].status).toBe('pending');
			expect(() => context.sqlite.prepare("DELETE FROM plans WHERE id='plan-01'").run()).toThrow('MANAGED_REPLICATION_BUSY');
			await create().tick();
			expect(store.listByBackup('backup-01')[0]).toMatchObject({ status: 'completed', destinationSnapshotId: 'f'.repeat(64), attempts: 1 });
			expect(store.getDestination('a'.repeat(64))).toMatchObject({ initState: 'ready', actualRepositoryId: 'e'.repeat(64) });
			expect(await backups.getById('backup-01')).toMatchObject({ status: 'completed', success: true, mirrors: [expect.objectContaining({ status: 'completed', snapshotId: 'f'.repeat(64) })] });
			await create().rescanCompleted(); await create().tick();
			expect(executor.copy).toHaveBeenCalledTimes(1);
			store.detach('plan-01', 'replica-01');
			const plans = new PlanStore(db);
			await plans.update('plan-01', { settings: { ...settings, replication: { enabled: false, concurrent: false, storages: [] } } });
			const mirror = (await backups.getById('backup-01'))!.mirrors![0];
			await backups.update('backup-01', { mirrors: [
				mirror,
				{ ...mirror, replicationId: 'unbound-replica' },
				{ ...mirror, storageId: 'unbound-storage' },
				{ ...mirror, storagePath: 'bucket-01/managed/other' },
			] });
			context.sqlite.exec(`INSERT INTO backups(id,plan_id,source_id,source_type,method,status,mirrors)
				SELECT 'backup-02',plan_id,source_id,source_type,method,status,mirrors FROM backups WHERE id='backup-01'`);
			const retained = await plans.getById('plan-01', true);
			expect(retained?.backups.find(backup => backup.id === 'backup-01')?.mirrors).toEqual([expect.objectContaining({
				replicationId: 'replica-01', status: 'completed', snapshotId: 'f'.repeat(64),
			})]);
			expect(retained?.backups.find(backup => backup.id === 'backup-02')?.mirrors).toEqual([]);
			const history = await new PlanService({} as any, plans, backups, {} as any, {} as any, {} as any)
				.getBackupHistory('plan-01', {});
			expect(history.items.find(backup => backup.id === 'backup-01')?.mirrors).toEqual([mirror]);
			expect(history.items.find(backup => backup.id === 'backup-02')?.mirrors).toEqual([]);
		} finally { context.sqlite.close(); }
	});
});
