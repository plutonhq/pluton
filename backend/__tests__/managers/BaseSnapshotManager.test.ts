import { BaseSnapshotManager } from '../../src/managers/BaseSnapshotManager';

// Mocks
const downloadHandlerMock = {
	download: jest.fn(),
	get: jest.fn(),
	cancel: jest.fn(),
};

jest.mock('../../src/managers/handlers/DownloadHandler', () => {
	return {
		DownloadHandler: jest.fn().mockImplementation(() => downloadHandlerMock),
	};
});

jest.mock('../../src/utils/restic/restic', () => ({
	runResticCommand: jest.fn(),
	getSnapshotByTag: jest.fn(),
	getBackupPlanStats: jest.fn(),
}));

jest.mock('../../src/utils/restic/helpers', () => ({
	generateResticRepoPath: jest.fn(() => 'mock-repo-path'),
	resticPathToWindows: jest.fn((p: string) => `WIN:${p}`),
}));

jest.mock('../../src/services/ConfigService', () => ({
	configService: {
		config: {
			ENCRYPTION_KEY: 'mySecretKey',
			NODE_ENV: 'test',
		},
	},
}));

jest.mock('fs/promises', () => ({
	readFile: jest.fn().mockRejectedValue(new Error('ENOENT: no such file or directory')),
	writeFile: jest.fn().mockResolvedValue(undefined),
}));

import {
	runResticCommand,
	getSnapshotByTag,
	getBackupPlanStats,
} from '../../src/utils/restic/restic';
import { generateResticRepoPath, resticPathToWindows } from '../../src/utils/restic/helpers';

describe('BaseSnapshotManager', () => {
	const originalPlatform = process.platform;
	const setPlatform = (plat: NodeJS.Platform) => {
		Object.defineProperty(process, 'platform', { value: plat });
	};

	beforeEach(() => {
		jest.clearAllMocks();
		// Reset platform for each test
		Object.defineProperty(process, 'platform', { value: originalPlatform });
	});

	afterAll(() => {
		Object.defineProperty(process, 'platform', { value: originalPlatform });
	});

	describe('listSnapshots', () => {
		it('should call restic snapshots with json flag', async () => {
			(runResticCommand as jest.Mock).mockResolvedValue('[]');
			const mgr = new BaseSnapshotManager();

			const res = await mgr.listSnapshots();

			expect((runResticCommand as jest.Mock).mock.calls[0][0]).toEqual(['snapshots', '--json']);
			expect(res).toBe('[]');
		});
	});

	describe('downloadSnapshot', () => {
		const options = { storageName: 's', storagePath: 'p', encryption: true };

		it('should resolve snapshot id and trigger download', async () => {
			(getSnapshotByTag as jest.Mock).mockResolvedValue({
				success: true,
				result: { id: 'snap-123' },
			});

			const mgr = new BaseSnapshotManager();
			downloadHandlerMock.download.mockResolvedValue('path/to/tar');

			const out = await mgr.downloadSnapshot('plan-1', 'backup-1', '/ignored', options);

			expect(getSnapshotByTag).toHaveBeenCalledWith('backup-backup-1', options);
			expect(downloadHandlerMock.download).toHaveBeenCalledWith(
				'plan-1',
				'backup-1',
				'snap-123',
				options
			);
			expect(out).toEqual({ success: true, result: 'Generating Download..' });
		});

		it('should return failure when snapshot not found', async () => {
			(getSnapshotByTag as jest.Mock).mockResolvedValue({
				success: false,
				result: 'Snapshot Not Found',
			});

			const mgr = new BaseSnapshotManager();

			const out = await mgr.downloadSnapshot('plan-1', 'backup-1', '/ignored', options);

			expect(downloadHandlerMock.download).not.toHaveBeenCalled();
			expect(out).toEqual({ success: false, result: 'Snapshot Not Found' });
		});
	});

	describe('getSnapshotDownload', () => {
		it('should return file stream info from handler', async () => {
			const mgr = new BaseSnapshotManager();
			const mockResult = { fileName: 'backup-1.tar', fileStream: {} };
			downloadHandlerMock.get.mockResolvedValue(mockResult);

			const out = await mgr.getSnapshotDownload('plan-1', 'backup-1');

			expect(downloadHandlerMock.get).toHaveBeenCalledWith('plan-1', 'backup-1');
			expect(out).toEqual({ success: true, result: mockResult });
		});
	});

	describe('cancelSnapshotDownload', () => {
		it('should cancel via handler and return message', async () => {
			const mgr = new BaseSnapshotManager();
			downloadHandlerMock.cancel.mockResolvedValue(true);

			const out = await mgr.cancelSnapshotDownload('plan-1', 'backup-1');

			expect(downloadHandlerMock.cancel).toHaveBeenCalledWith('plan-1', 'backup-1');
			expect(out).toEqual({ success: true, result: 'Download cancelled' });
		});
	});

	describe('removeSnapshot', () => {
		const options = {
			storageName: 'store',
			storagePath: 'path',
			encryption: true,
			planId: 'plan-1',
		};

		it('should forget snapshot and return updated stats', async () => {
			(getSnapshotByTag as jest.Mock).mockResolvedValue({
				success: true,
				result: { id: 'snap-abc' },
			});
			(runResticCommand as jest.Mock).mockResolvedValue('forget-ok');
			(getBackupPlanStats as jest.Mock).mockResolvedValue({
				total_size: 123,
				snapshots: ['a', 'b'],
			});

			const mgr = new BaseSnapshotManager();
			const out = await mgr.removeSnapshot(options.planId, 'backup-1', options);

			expect(generateResticRepoPath).toHaveBeenCalledWith('store', 'path');
			expect(runResticCommand).toHaveBeenCalledWith(
				['-r', 'mock-repo-path', 'forget', 'snap-abc', '--json'],
				{ RESTIC_PASSWORD: 'mySecretKey' }
			);
			expect(getBackupPlanStats).toHaveBeenCalledWith('plan-1', 'store', 'path', true);
			expect(out).toEqual({
				success: true,
				result: 'forget-ok',
				stats: { total_size: 123, snapshots: ['a', 'b'] },
			});
		});

		it('should return early when snapshot not found', async () => {
			(getSnapshotByTag as jest.Mock).mockResolvedValue({
				success: false,
				result: 'Snapshot Not Found',
			});

			const mgr = new BaseSnapshotManager();
			const out = await mgr.removeSnapshot(options.planId, 'backup-1', options);

			expect(runResticCommand).not.toHaveBeenCalled();
			expect(out).toEqual({ success: false, result: 'Snapshot Not Found' });
		});
	});

	describe('getSnapshotFiles', () => {
		const baseOptions = { storageName: 'store', storagePath: 'path', encryption: true };

		it('should parse files on linux and normalize backslashes', async () => {
			setPlatform('linux');

			(getSnapshotByTag as jest.Mock).mockResolvedValue({
				success: true,
				result: { id: 'snap-1' },
			});

			const lines = [
				{
					name: 'dir',
					path: '/home/user',
					type: 'dir',
					size: 0,
					mtime: '2024-01-01T00:00:00Z',
					permissions: 'drwxr-xr-x',
				},
				{
					name: 'file.txt',
					path: 'C:\\Users\\bob\\file.txt',
					type: 'file',
					size: 10,
					mtime: '2024-01-01T00:00:01Z',
					permissions: '-rw-r--r--',
				},
			]
				.map(o => JSON.stringify(o))
				.join('\n');

			(runResticCommand as jest.Mock).mockResolvedValue(lines);

			const mgr = new BaseSnapshotManager();
			const out = await mgr.getSnapshotFiles('backup-1', baseOptions);

			expect(out.success).toBe(true);
			const files = (out as any).result as any[];
			expect(files).toHaveLength(2);
			expect(files[0]).toMatchObject({
				name: 'dir',
				path: '/home/user',
				isDirectory: true,
				srcPath: '/home/user',
				permissions: 'drwxr-xr-x',
			});
			expect(files[1]).toMatchObject({
				name: 'file.txt',
				path: 'C:\\Users\\bob\\file.txt',
				isDirectory: false,
				srcPath: 'C:/Users/bob/file.txt',
				permissions: '-rw-r--r--',
			});
			expect(resticPathToWindows).not.toHaveBeenCalled();
			// env should use configService ENCRYPTION_KEY when encryption=true
			expect((runResticCommand as jest.Mock).mock.calls[0][1]).toEqual({
				RESTIC_PASSWORD: 'mySecretKey',
			});
		});

		it('should use resticPathToWindows on win32', async () => {
			setPlatform('win32');

			(getSnapshotByTag as jest.Mock).mockResolvedValue({
				success: true,
				result: { id: 'snap-2' },
			});

			const item = {
				name: 'file.txt',
				path: '/C/Users/bob/file.txt',
				type: 'file',
				size: 1,
				mtime: '2024-01-01T00:00:00Z',
				permissions: '-rw-r--r--',
			};
			(runResticCommand as jest.Mock).mockResolvedValue(JSON.stringify(item));
			(resticPathToWindows as jest.Mock).mockReturnValue('C:\\Users\\bob\\file.txt');

			const mgr = new BaseSnapshotManager();
			const out = await mgr.getSnapshotFiles('backup-2', baseOptions);

			expect(out.success).toBe(true);
			const files = (out as any).result as any[];
			expect(resticPathToWindows).toHaveBeenCalledWith('/C/Users/bob/file.txt');
			expect(files[0]).toMatchObject({
				srcPath: 'C:\\Users\\bob\\file.txt',
				isDirectory: false,
			});
			expect((runResticCommand as jest.Mock).mock.calls[0][0]).toEqual([
				'ls',
				'-r',
				'mock-repo-path',
				'snap-2',
				'--json',
				'--long',
			]);
			expect((runResticCommand as jest.Mock).mock.calls[0][1]).toEqual({
				RESTIC_PASSWORD: 'mySecretKey',
			});
		});

		it('should return failure when restic ls throws', async () => {
			setPlatform('linux');

			(getSnapshotByTag as jest.Mock).mockResolvedValue({
				success: true,
				result: { id: 'snap-err' },
			});
			(runResticCommand as jest.Mock).mockRejectedValue(new Error('boom'));

			const mgr = new BaseSnapshotManager();
			const out = await mgr.getSnapshotFiles('backup-err', baseOptions);

			expect(out.success).toBe(false);
			expect(String(out.result)).toContain('boom');
		});

		it('should return failure when snapshot not found', async () => {
			(getSnapshotByTag as jest.Mock).mockResolvedValue({
				success: false,
				result: 'Snapshot not found',
			});

			const mgr = new BaseSnapshotManager();
			const out = await mgr.getSnapshotFiles('backup-x', baseOptions);

			expect(out).toEqual({ success: false, result: 'Snapshot not found' });
			expect(runResticCommand).not.toHaveBeenCalled();
		});
	});
});
