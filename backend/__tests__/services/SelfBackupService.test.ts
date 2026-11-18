import fs from 'fs';
import os from 'os';
import path from 'path';

let mockDataDir: string;

jest.mock('../../src/utils/AppPaths', () => ({
	appPaths: {
		getDataDir: () => mockDataDir,
		getConfigDir: () => path.join(mockDataDir, 'config'),
		getDbDir: () => path.join(mockDataDir, 'db'),
		getProgressDir: () => path.join(mockDataDir, 'progress'),
		getSyncDir: () => path.join(mockDataDir, 'sync'),
		getSchedulesPath: () => path.join(mockDataDir, 'schedules.json'),
		getTempDir: () => path.join(mockDataDir, 'temp'),
	},
}));

jest.mock('../../src/services/ConfigService', () => ({
	configService: { config: { ENCRYPTION_KEY: 'test-encryption-key-1234' } },
}));

const mockRunRcloneCommand = jest.fn();
jest.mock('../../src/utils/rclone/rclone', () => ({
	runRcloneCommand: (...args: any[]) => mockRunRcloneCommand(...args),
}));

jest.mock('../../src/utils/logger', () => ({
	cronLogger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
	logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

// Factory mocks keep the real modules — and the live `db/index` handle
// NotificationChannelResolver would otherwise open at import time — out of the graph.
const mockSend = jest.fn().mockResolvedValue({ success: true, result: 'ok' });
const mockGetChannel = jest.fn().mockResolvedValue({ send: mockSend });
jest.mock('../../src/notifications/channels/NotificationChannelResolver', () => ({
	NotificationChannelResolver: { getChannel: (...args: any[]) => mockGetChannel(...args) },
}));
jest.mock(
	'../../src/notifications/templates/email/backup/SelfBackupFailedNotification',
	() => ({
		SelfBackupFailedNotification: jest
			.fn()
			.mockImplementation((data: any) => ({ __data: data })),
	})
);

import { SelfBackupService } from '../../src/services/SelfBackupService';
import { jobQueue } from '../../src/jobs/JobQueue';
import { SELF_BACKUP_JOB_NAME } from '../../src/jobs/systemJobs';
import { writeSelfBackupState, readSelfBackupState } from '../../src/utils/selfBackup/state';
import { computeFingerprint } from '../../src/utils/selfBackup/payload';

/** Comfortably outside any interval a test uses, so "did this advance?" is unambiguous. */
const OLD_TIMESTAMP = '2020-01-01T00:00:00.000Z';

const ENABLED = {
	enabled: true,
	storageId: 'stor-1',
	storageName: 'mybackups',
	path: 'pluton/self',
	intervalHours: 12,
	retention: 10,
};

function makeService(
	overrides: {
		selfBackup?: any;
		storageName?: string | null;
		storage?: Record<string, any>;
		adminEmail?: string;
		integration?: Record<string, any>;
	} = {}
) {
	const settingsStore = {
		getFirst: jest.fn().mockResolvedValue({
			id: 1,
			settings: {
				title: 'Pluton',
				admin_email: overrides.adminEmail ?? '',
				integration: overrides.integration ?? {},
				// `in` rather than ?? so a test can pass an explicit undefined.
				selfBackup: 'selfBackup' in overrides ? overrides.selfBackup : ENABLED,
			},
		}),
	} as any;

	const storageStore = {
		getById: jest
			.fn()
			.mockResolvedValue(
				overrides.storageName === null
					? null
					: {
							id: 'stor-1',
							type: 's3',
							name: overrides.storageName ?? 'mybackups',
							...(overrides.storage ?? {}),
						}
			),
	} as any;

	// VACUUM INTO is exercised for real in the spike; here it only needs to produce a file.
	const sqlite = {
		pragma: jest.fn().mockReturnValue(7),
		prepare: jest.fn().mockReturnValue({
			run: (dest: string) => fs.writeFileSync(dest, 'vacuumed-db'),
		}),
	} as any;

	return {
		service: new SelfBackupService(settingsStore, storageStore, sqlite, 'core'),
		settingsStore,
		storageStore,
		sqlite,
	};
}

const rcloneCalls = (verb: string) =>
	mockRunRcloneCommand.mock.calls.filter(call => call[0][0] === verb);

describe('SelfBackupService', () => {
	let tmpDir: string;

	beforeEach(() => {
		jest.clearAllMocks();
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'selfbackup-svc-'));
		mockDataDir = tmpDir;
		fs.mkdirSync(path.join(tmpDir, 'config'), { recursive: true });
		fs.mkdirSync(path.join(tmpDir, 'db'), { recursive: true });
		fs.mkdirSync(path.join(tmpDir, 'temp'), { recursive: true });
		fs.writeFileSync(path.join(tmpDir, 'db', 'pluton.db'), 'db');
		mockRunRcloneCommand.mockResolvedValue('');
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it('does nothing and makes zero rclone calls when disabled', async () => {
		const { service } = makeService({ selfBackup: { ...ENABLED, enabled: false } });
		await expect(service.run()).resolves.toEqual({ status: 'disabled' });
		expect(mockRunRcloneCommand).not.toHaveBeenCalled();
	});

	it('treats a missing selfBackup block as disabled (existing installs)', async () => {
		const { service } = makeService({ selfBackup: undefined });
		await expect(service.run()).resolves.toEqual({ status: 'disabled' });
		expect(mockRunRcloneCommand).not.toHaveBeenCalled();
	});

	it('skips with zero rclone calls when the fingerprint is unchanged', async () => {
		writeSelfBackupState({ lastFingerprint: computeFingerprint() });
		const { service } = makeService();

		await expect(service.run()).resolves.toEqual({ status: 'skipped' });
		expect(mockRunRcloneCommand).not.toHaveBeenCalled();
	});

	it('a completed run leaves a fingerprint that suppresses the next one', async () => {
		// Regression: the service writes self_backup_state.json at the end of every run. If
		// that file fed the fingerprint, each run would invalidate the fingerprint it had just
		// recorded and the skip path could never fire, so an idle instance would upload forever.
		const { service } = makeService();
		await expect(service.run()).resolves.toMatchObject({ status: 'uploaded' });

		mockRunRcloneCommand.mockClear();
		await expect(service.run()).resolves.toEqual({ status: 'skipped' });
		expect(mockRunRcloneCommand).not.toHaveBeenCalled();
	});

	it('force overrides an unchanged fingerprint', async () => {
		writeSelfBackupState({ lastFingerprint: computeFingerprint() });
		const { service } = makeService();

		const result = await service.run({ force: true });
		expect(result.status).toBe('uploaded');
		expect(rcloneCalls('copyto').length).toBeGreaterThan(0);
	});

	it('uploads the blob and the sidecar with the expected copyto argv', async () => {
		const { service } = makeService();
		const result = await service.run();

		expect(result.status).toBe('uploaded');
		expect(result.blobName).toMatch(/^pluton-.*\.pluton$/);

		const copytos = rcloneCalls('copyto');
		expect(copytos).toHaveLength(2);

		const [blobArgs] = copytos[0];
		expect(blobArgs[2]).toBe(`mybackups:pluton/self/${result.blobName}`);
		// A timeout is passed: an unbounded hang here would wedge the global job lock.
		expect(copytos[0][2]).toEqual({ timeoutMs: expect.any(Number) });

		const [sidecarArgs] = copytos[1];
		expect(sidecarArgs[2]).toBe('mybackups:pluton/self/pluton-recovery.json');
	});

	it('targets the remote root without a stray leading slash when path is empty', async () => {
		// `remote:/blob` would mean the filesystem root on a local remote, not the remote's root.
		const { service } = makeService({ selfBackup: { ...ENABLED, path: '' } });
		const result = await service.run();

		expect(rcloneCalls('copyto')[0][0][2]).toBe(`mybackups:${result.blobName}`);
	});

	it('tolerates leading and trailing slashes in the configured path', async () => {
		const { service } = makeService({ selfBackup: { ...ENABLED, path: '/pluton/self/' } });
		const result = await service.run();

		expect(rcloneCalls('copyto')[0][0][2]).toBe(`mybackups:pluton/self/${result.blobName}`);
	});

	describe('local storage', () => {
		const LOCAL_STORAGE = { id: 'local', type: 'local', name: 'Local Storage' };

		const makeLocalService = (targetPath: string) =>
			makeService({
				storage: LOCAL_STORAGE,
				selfBackup: {
					...ENABLED,
					storageId: 'local',
					storageName: 'Local Storage',
					path: targetPath,
				},
			}).service;

		it('addresses the built-in local storage by its rclone remote name', async () => {
			// The row is named "Local Storage", but rclone only knows the section "local".
			const service = makeLocalService(tmpDir);
			const result = await service.run();

			expect(rcloneCalls('copyto')[0][0][2]).toBe(`local:${tmpDir}/${result.blobName}`);
		});

		it('keeps a local path absolute, trailing slash aside', async () => {
			// Stripping the leading slash would make rclone resolve it against its own cwd.
			const service = makeLocalService(`${tmpDir}/`);
			const result = await service.run();

			expect(rcloneCalls('copyto')[0][0][2]).toBe(`local:${tmpDir}/${result.blobName}`);
		});

		it('refuses a local folder that does not exist instead of creating one', async () => {
			// rclone would create it and report success, quietly backing up into the container.
			const service = makeLocalService(path.join(tmpDir, 'not-mounted'));

			await expect(service.run()).rejects.toMatchObject({
				message: expect.stringMatching(/does not exist or is not writable/),
				retryable: false,
			});
			expect(mockRunRcloneCommand).not.toHaveBeenCalled();
		});

		it('refuses an empty local path, which would mean rclone\'s working directory', async () => {
			const service = makeLocalService('');

			await expect(service.run()).rejects.toMatchObject({
				message: expect.stringMatching(/Select a folder/),
				retryable: false,
			});
			expect(mockRunRcloneCommand).not.toHaveBeenCalled();
		});
	});

	it('records success state including the fingerprint it uploaded', async () => {
		const { service } = makeService();
		const result = await service.run();

		const state = readSelfBackupState();
		expect(state.lastSuccessAt).toBeTruthy();
		expect(state.lastError).toBeNull();
		expect(state.lastBlobName).toBe(result.blobName);
		expect(state.lastFingerprint).toBeTruthy();
	});

	it('stamps lastRunAt and lastSuccessAt from a single clock read', async () => {
		// A run that succeeded ran and succeeded at the same instant. Two separate `new Date()`
		// calls are equal almost always, so a drifting pair passes every test and then straddles
		// a millisecond in production, leaving the state file quietly self-contradictory.
		const { service } = makeService();
		await service.run();

		const state = readSelfBackupState();
		expect(state.lastRunAt).toBe(state.lastSuccessAt);
	});

	it('treats a skip as a success, so an idle instance never looks stale', async () => {
		// An unchanged fingerprint means the blob already on the remote still matches this
		// install: Pluton IS backed up as of now. Advancing only lastRunAt would leave an idle
		// instance -- behaving exactly as designed -- tripping the stale alarm after 2x the
		// interval, training the user to ignore the one alarm that has to be trustworthy.
		writeSelfBackupState({ lastFingerprint: computeFingerprint(), lastSuccessAt: OLD_TIMESTAMP });
		const { service } = makeService();

		await expect(service.run()).resolves.toEqual({ status: 'skipped' });

		const state = readSelfBackupState();
		expect(state.lastSuccessAt).not.toBe(OLD_TIMESTAMP);
		expect(state.lastRunAt).toBe(state.lastSuccessAt);
		expect(state.lastError).toBeNull();
		expect(mockRunRcloneCommand).not.toHaveBeenCalled();
	});

	it('deletes exactly the blobs beyond the retention count, oldest first', async () => {
		const names = [
			'pluton-2026-01-01T00-00-00-000Z.pluton',
			'pluton-2026-01-02T00-00-00-000Z.pluton',
			'pluton-2026-01-03T00-00-00-000Z.pluton',
			'pluton-2026-01-04T00-00-00-000Z.pluton',
			'pluton-2026-01-05T00-00-00-000Z.pluton',
		];
		mockRunRcloneCommand.mockImplementation((args: string[]) => {
			if (args[0] === 'lsjson') {
				return Promise.resolve(
					JSON.stringify([
						...names.map(Name => ({ Name, Path: Name, Size: 10, IsDir: false })),
						// Neither the sidecar nor a directory is a retention candidate.
						{ Name: 'pluton-recovery.json', Path: 'pluton-recovery.json', Size: 2, IsDir: false },
						{ Name: 'pluton-olddir.pluton', Path: 'pluton-olddir.pluton', Size: 0, IsDir: true },
					])
				);
			}
			return Promise.resolve('');
		});

		const { service } = makeService({ selfBackup: { ...ENABLED, retention: 2 } });
		await service.run();

		const deleted = rcloneCalls('deletefile').map(call => call[0][1]);
		expect(deleted).toEqual([
			'mybackups:pluton/self/pluton-2026-01-03T00-00-00-000Z.pluton',
			'mybackups:pluton/self/pluton-2026-01-02T00-00-00-000Z.pluton',
			'mybackups:pluton/self/pluton-2026-01-01T00-00-00-000Z.pluton',
		]);
	});

	it('does not fail the run when retention deletion rejects, since the blob is already safe', async () => {
		mockRunRcloneCommand.mockImplementation((args: string[]) => {
			if (args[0] === 'lsjson') {
				return Promise.resolve(
					JSON.stringify([
						{ Name: 'pluton-a.pluton', Path: 'a', Size: 1, IsDir: false },
						{ Name: 'pluton-b.pluton', Path: 'b', Size: 1, IsDir: false },
					])
				);
			}
			if (args[0] === 'deletefile') return Promise.reject(new Error('remote said no'));
			return Promise.resolve('');
		});

		const { service } = makeService({ selfBackup: { ...ENABLED, retention: 1 } });
		await expect(service.run()).resolves.toMatchObject({ status: 'uploaded' });
	});

	it('does not fail the run when lsjson returns a warning instead of JSON', async () => {
		mockRunRcloneCommand.mockImplementation((args: string[]) =>
			args[0] === 'lsjson'
				? Promise.resolve('NOTICE: config file not encrypted')
				: Promise.resolve('')
		);

		const { service } = makeService();
		await expect(service.run()).resolves.toMatchObject({ status: 'uploaded' });
		expect(rcloneCalls('deletefile')).toHaveLength(0);
	});

	it('throws and records the error when the upload fails, so the job retries', async () => {
		mockRunRcloneCommand.mockImplementation((args: string[]) =>
			args[0] === 'copyto' ? Promise.reject(new Error('network down')) : Promise.resolve('')
		);

		const { service } = makeService();
		await expect(service.run()).rejects.toThrow('network down');

		const state = readSelfBackupState();
		expect(state.lastError).toBe('network down');
		expect(state.lastSuccessAt).toBeUndefined();
	});

	it('passes a storage name with spaces through to rclone unquoted', async () => {
		// Safe because runRcloneCommand spawns with an argv array and no shell, so the name
		// reaches rclone as a single argument. Nothing needs to escape or reject it.
		const { service } = makeService({ storageName: 'My Backups' });

		const result = await service.run();
		expect(rcloneCalls('copyto')[0][0][2]).toBe(`My Backups:pluton/self/${result.blobName}`);
	});

	it('refuses when the selected storage no longer exists', async () => {
		const { service } = makeService({ storageName: null });
		await expect(service.run()).rejects.toThrow(/no longer exists/);
	});

	it('removes the temp dir on success', async () => {
		const { service } = makeService();
		await service.run();
		expect(fs.readdirSync(path.join(tmpDir, 'temp'))).toEqual([]);
	});

	it('removes the temp dir when the run throws', async () => {
		mockRunRcloneCommand.mockRejectedValue(new Error('boom'));
		const { service } = makeService();
		await expect(service.run()).rejects.toThrow('boom');
		expect(fs.readdirSync(path.join(tmpDir, 'temp'))).toEqual([]);
	});

	describe('isDue', () => {
		it('is false when disabled', async () => {
			const { service } = makeService({ selfBackup: { ...ENABLED, enabled: false } });
			expect(await service.isDue()).toBe(false);
		});

		it('is true when there has never been a run', async () => {
			const { service } = makeService();
			expect(await service.isDue()).toBe(true);
		});

		it('is false an hour after a run with a 12h interval', async () => {
			writeSelfBackupState({ lastRunAt: new Date(Date.now() - 3600_000).toISOString() });
			const { service } = makeService();
			expect(await service.isDue()).toBe(false);
		});

		it('is true 13 hours after a run with a 12h interval', async () => {
			writeSelfBackupState({ lastRunAt: new Date(Date.now() - 13 * 3600_000).toISOString() });
			const { service } = makeService();
			expect(await service.isDue()).toBe(true);
		});

		it('waits a full interval after a failed run', async () => {
			// Gating on lastSuccessAt made a failing backup repeat its whole cycle every hour.
			writeSelfBackupState({
				lastSuccessAt: new Date(Date.now() - 13 * 3600_000).toISOString(),
				lastRunAt: new Date(Date.now() - 3600_000).toISOString(),
			});
			const { service } = makeService();
			expect(await service.isDue()).toBe(false);
		});
	});

	describe('getStatus', () => {
		it('merges the resolved settings with the runtime state file', async () => {
			writeSelfBackupState({ lastSuccessAt: '2026-07-15T00:00:00.000Z', lastBlobName: 'b.pluton' });
			const { service } = makeService();

			const status = await service.getStatus();
			expect(status).toMatchObject({
				enabled: true,
				intervalHours: 12,
				retention: 10,
				lastSuccessAt: '2026-07-15T00:00:00.000Z',
				lastBlobName: 'b.pluton',
			});
		});

		it('reports running straight from the job queue, in both directions', async () => {
			// The UI polls on this. It used to be inferred by comparing lastRunAt against
			// lastSuccessAt, which cannot tell a running job apart from a skipped one and never
			// fires on the first-ever run, when there is no lastRunAt to compare against yet.
			const { service } = makeService();
			expect((await service.getStatus()).running).toBe(false);

			jobQueue.add(SELF_BACKUP_JOB_NAME, { force: true }, 1, 0);
			expect((await service.getStatus()).running).toBe(true);
		});
	});

	describe('listBackups', () => {
		it('returns only blobs, newest first, with size and modTime', async () => {
			mockRunRcloneCommand.mockImplementation((args: string[]) => {
				if (args[0] === 'lsjson') {
					return Promise.resolve(
						JSON.stringify([
							{ Name: 'pluton-2026-01-01T00-00-00-000Z.pluton', Size: 10, ModTime: 't1', IsDir: false },
							{ Name: 'pluton-2026-01-03T00-00-00-000Z.pluton', Size: 30, ModTime: 't3', IsDir: false },
							{ Name: 'pluton-2026-01-02T00-00-00-000Z.pluton', Size: 20, ModTime: 't2', IsDir: false },
							// Sidecar and a directory must be excluded.
							{ Name: 'pluton-recovery.json', Size: 2, IsDir: false },
							{ Name: 'pluton-dir.pluton', Size: 0, IsDir: true },
						])
					);
				}
				return Promise.resolve('');
			});

			const { service } = makeService();
			const list = await service.listBackups();

			expect(list).toEqual([
				{ name: 'pluton-2026-01-03T00-00-00-000Z.pluton', size: 30, modTime: 't3' },
				{ name: 'pluton-2026-01-02T00-00-00-000Z.pluton', size: 20, modTime: 't2' },
				{ name: 'pluton-2026-01-01T00-00-00-000Z.pluton', size: 10, modTime: 't1' },
			]);
		});

		it('returns an empty list when no storage is configured', async () => {
			const { service } = makeService({ selfBackup: { ...ENABLED, storageId: '' } });
			expect(await service.listBackups()).toEqual([]);
			expect(mockRunRcloneCommand).not.toHaveBeenCalled();
		});
	});

	describe('downloadBackup', () => {
		const blob = 'pluton-2026-01-01T00-00-00-000Z.pluton';

		it('copies a valid blob to a temp file and cleans it up afterwards', async () => {
			const { service } = makeService();
			const { localPath, cleanup } = await service.downloadBackup(blob);

			const copytos = rcloneCalls('copyto');
			expect(copytos).toHaveLength(1);
			expect(copytos[0][0][1]).toBe(`mybackups:pluton/self/${blob}`);
			expect(copytos[0][0][2]).toBe(localPath);
			expect(fs.existsSync(path.dirname(localPath))).toBe(true);

			await cleanup();
			expect(fs.existsSync(path.dirname(localPath))).toBe(false);
		});

		it('rejects a blob name that is not a Pluton blob', async () => {
			const { service } = makeService();
			await expect(service.downloadBackup('../rclone.conf')).rejects.toThrow(/Invalid backup name/);
			expect(mockRunRcloneCommand).not.toHaveBeenCalled();
		});

		it('cleans up the temp dir when the remote copy fails', async () => {
			mockRunRcloneCommand.mockRejectedValue(new Error('remote down'));
			const { service } = makeService();
			await expect(service.downloadBackup(blob)).rejects.toThrow('remote down');
			// Nothing left behind under the temp dir.
			expect(fs.readdirSync(path.join(tmpDir, 'temp'))).toEqual([]);
		});
	});

	describe('failure notification', () => {
		const failUpload = () =>
			mockRunRcloneCommand.mockImplementation((args: string[]) =>
				args[0] === 'copyto' ? Promise.reject(new Error('network down')) : Promise.resolve('')
			);

		it('emails the admin via the first connected email integration on failure', async () => {
			failUpload();
			const { service } = makeService({
				selfBackup: { ...ENABLED, notifyOnFailure: true },
				adminEmail: 'admin@example.com',
				integration: { smtp: { connected: true } },
			});

			await expect(service.run()).rejects.toThrow('network down');
			expect(mockGetChannel).toHaveBeenCalledWith('smtp');
			expect(mockSend).toHaveBeenCalledWith(expect.anything(), { emails: 'admin@example.com' });
		});

		it('does not email when the toggle is off', async () => {
			failUpload();
			const { service } = makeService({
				selfBackup: { ...ENABLED, notifyOnFailure: false },
				adminEmail: 'admin@example.com',
				integration: { smtp: { connected: true } },
			});

			await expect(service.run()).rejects.toThrow('network down');
			expect(mockGetChannel).not.toHaveBeenCalled();
		});

		it('does not email when no email integration is connected', async () => {
			failUpload();
			const { service } = makeService({
				selfBackup: { ...ENABLED, notifyOnFailure: true },
				adminEmail: 'admin@example.com',
				integration: { smtp: { connected: false } },
			});

			await expect(service.run()).rejects.toThrow('network down');
			expect(mockGetChannel).not.toHaveBeenCalled();
		});

		it('does not email before the last attempt', async () => {
			failUpload();
			const { service } = makeService({
				selfBackup: { ...ENABLED, notifyOnFailure: true },
				adminEmail: 'admin@example.com',
				integration: { smtp: { connected: true } },
			});

			await expect(service.run({ isLastAttempt: false })).rejects.toThrow('network down');
			expect(mockGetChannel).not.toHaveBeenCalled();
		});

		it('emails at once, without retries, when the selected storage no longer exists', async () => {
			const { service } = makeService({
				storageName: null,
				selfBackup: { ...ENABLED, notifyOnFailure: true },
				adminEmail: 'admin@example.com',
				integration: { smtp: { connected: true } },
			});

			const error = await service.run({ isLastAttempt: false }).catch(e => e);
			expect(error.message).toMatch(/no longer exists/);
			expect(error.retryable).toBe(false);
			expect(readSelfBackupState().lastError).toMatch(/no longer exists/);
			expect(mockSend).toHaveBeenCalled();
		});

		it('still surfaces the backup error even if the email send throws', async () => {
			failUpload();
			mockGetChannel.mockRejectedValueOnce(new Error('smtp boom'));
			const { service } = makeService({
				selfBackup: { ...ENABLED, notifyOnFailure: true },
				adminEmail: 'admin@example.com',
				integration: { smtp: { connected: true } },
			});

			await expect(service.run()).rejects.toThrow('network down');
		});
	});
});
