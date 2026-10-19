import { RemoteStrategy as RemoteBackupStrategy } from '../../src/strategies/backup';
import { RemoteStrategy as RemoteRestoreStrategy } from '../../src/strategies/restore';
import { RemoteStrategy as RemoteSnapshotStrategy } from '../../src/strategies/snapshot';
import { RemoteStrategy as RemoteSystemStrategy } from '../../src/strategies/system';

describe('unimplemented remote strategies', () => {
	it('fail closed instead of reporting a backup as successful', async () => {
		const result = await new RemoteBackupStrategy('remote-1').createBackup('plan-1', {});
		expect(result).toEqual({ success: false, result: 'REMOTE_CAPABILITY_NOT_IMPLEMENTED' });
	});

	it.each([
		['system metrics', () => new RemoteSystemStrategy('remote-1').getMetrics()],
		['snapshot download', () => new RemoteSnapshotStrategy('remote-1').getSnapshotDownload('plan-1', 'backup-1')],
		['restore', () => new RemoteRestoreStrategy('remote-1').restoreSnapshot('plan-1', 'backup-1', {} as any)],
	])('fails closed for %s', async (_name, operation) => {
		await expect(operation()).resolves.toEqual({ success: false, result: 'REMOTE_CAPABILITY_NOT_IMPLEMENTED' });
	});
});
