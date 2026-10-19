import { EventEmitter } from 'events';

jest.mock('child_process');
jest.mock('../../../src/utils/binaryPathResolver');

import { spawn } from 'child_process';
import { getBinaryPath } from '../../../src/utils/binaryPathResolver';
import {
	LegacyRepositoryInspectionError,
	ResticLegacyRepositoryInspector,
} from '../../../src/utils/restic/LegacyRepositoryInspector';

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;
const mockGetBinaryPath = getBinaryPath as jest.MockedFunction<typeof getBinaryPath>;

describe('ResticLegacyRepositoryInspector', () => {
	let child: EventEmitter & {
		stdout: EventEmitter;
		stderr: EventEmitter;
		kill: jest.Mock;
	};

	beforeEach(() => {
		jest.clearAllMocks();
		mockGetBinaryPath.mockReturnValue('C:\\test-tools\\restic.exe');
		child = Object.assign(new EventEmitter(), {
			stdout: new EventEmitter(),
			stderr: new EventEmitter(),
			kill: jest.fn(),
		});
		mockSpawn.mockReturnValue(child as never);
	});

	it('lists snapshots through a fixed read-only JSON command', async () => {
		const inspector = new ResticLegacyRepositoryInspector();
		const repositoryPath = 'C:\\fixtures\\legacy-restic-repository';
		const password = 'adapter-test-password';
		const snapshotsPromise = inspector.listSnapshots(repositoryPath, password);

		setImmediate(() => {
			child.stdout.emit(
				'data',
				Buffer.from(
					JSON.stringify([
						{
							id: 'a'.repeat(64),
							short_id: 'aaaaaaaa',
							time: '2026-01-02T03:04:05.000Z',
							hostname: 'fixture-host',
							tags: ['daily'],
							paths: ['C:\\fixtures\\source'],
						},
					])
				)
			);
			child.emit('close', 0);
		});

		await expect(snapshotsPromise).resolves.toEqual([
			expect.objectContaining({
				id: 'a'.repeat(64),
				shortId: 'aaaaaaaa',
				hostname: 'fixture-host',
				tags: ['daily'],
			}),
		]);

		expect(mockSpawn).toHaveBeenCalledWith(
			'C:\\test-tools\\restic.exe',
			[
				'--no-lock',
				'--no-cache',
				'--json',
				'--repo',
				repositoryPath,
				'snapshots',
			],
			expect.objectContaining({ shell: false, windowsHide: true })
		);
		const args = mockSpawn.mock.calls[0][1] as string[];
		const options = mockSpawn.mock.calls[0][2];
		const environment = options?.env as NodeJS.ProcessEnv;
		expect(args.join(' ')).not.toContain(password);
		expect(environment.RESTIC_PASSWORD).toBe(password);
		expect(environment.RESTIC_REPOSITORY).toBeUndefined();
		expect(environment.RESTIC_REPOSITORY_FILE).toBeUndefined();
		expect(environment.RESTIC_PASSWORD_COMMAND).toBeUndefined();
		expect(environment.RESTIC_PASSWORD_FILE).toBeUndefined();
	});

	it('returns normalized safe stats from Restic JSON', async () => {
		const inspector = new ResticLegacyRepositoryInspector();
		const statsPromise = inspector.getRepositoryStats(
			'C:\\fixtures\\legacy-restic-repository',
			'adapter-test-password'
		);

		setImmediate(() => {
			child.stdout.emit(
				'data',
				Buffer.from(
					JSON.stringify({
						total_size: 1024,
						total_uncompressed_size: 2048,
						compression_ratio: 2,
						total_blob_count: 7,
						snapshots_count: 2,
					})
				)
			);
			child.emit('close', 0);
		});

		await expect(statsPromise).resolves.toEqual({
			totalSize: 1024,
			totalUncompressedSize: 2048,
			compressionRatio: 2,
			totalBlobCount: 7,
			snapshotCount: 2,
		});
		expect(mockSpawn.mock.calls[0][1]).toContain('stats');
		expect(mockSpawn.mock.calls[0][1]).toContain('raw-data');
	});

	it('lists only direct children through fixed structured ls arguments', async () => {
		const inspector = new ResticLegacyRepositoryInspector();
		const snapshotId = 'a'.repeat(64);
		const directoryPromise = inspector.listSnapshotDirectory(
			'C:\\fixtures\\legacy-restic-repository',
			'adapter-test-password',
			snapshotId,
			'app-01/application'
		);

		setImmediate(() => {
			child.stdout.emit(
				'data',
				Buffer.from(
					[
						JSON.stringify({ message_type: 'snapshot', id: snapshotId }),
						JSON.stringify({
							message_type: 'node',
							name: 'application',
							type: 'dir',
							path: '/app-01/application',
							permissions: 'drwxr-xr-x',
						}),
						JSON.stringify({
							message_type: 'node',
							name: 'config',
							type: 'dir',
							path: '/app-01/application/config',
							mtime: '2026-01-02T03:04:05.000Z',
							permissions: 'drwxr-xr-x',
						}),
						JSON.stringify({
							message_type: 'node',
							name: 'index.txt',
							type: 'file',
							path: '/app-01/application/index.txt',
							size: 7,
							mtime: '2026-01-02T03:04:05.000Z',
							permissions: '-rw-r--r--',
						}),
						JSON.stringify({
							message_type: 'node',
							name: 'nested.txt',
							type: 'file',
							path: '/app-01/application/config/nested.txt',
							size: 1,
						}),
						JSON.stringify({
							message_type: 'node',
							name: 'link',
							type: 'symlink',
							path: '/app-01/application/link',
							permissions: 'Lrwxrwxrwx',
						}),
					].join('\n')
				)
			);
			child.emit('close', 0);
		});

		await expect(directoryPromise).resolves.toEqual({
			path: 'app-01/application',
			entries: [
				expect.objectContaining({ path: 'app-01/application/config', type: 'directory' }),
				expect.objectContaining({ path: 'app-01/application/index.txt', type: 'file', size: 7 }),
				expect.objectContaining({ path: 'app-01/application/link', type: 'symlink', isSymlink: true }),
			],
		});
		expect(mockSpawn.mock.calls[0][1]).toEqual(
			expect.arrayContaining(['--no-lock', '--no-cache', '--json', 'ls', snapshotId, '/app-01/application', '--long'])
		);
	});

	it.each(['../etc/passwd', 'app-01//application', '%2e%2e/etc/passwd', 'app-01\\application'])(
		'rejects unsafe snapshot path %p before spawning Restic',
		async unsafePath => {
			const inspector = new ResticLegacyRepositoryInspector();

			await expect(
				inspector.listSnapshotDirectory(
					'C:\\fixtures\\legacy-restic-repository',
					'adapter-test-password',
					'a'.repeat(64),
					unsafePath
				)
			).rejects.toMatchObject({ statusCode: 400 });
			expect(mockSpawn).not.toHaveBeenCalled();
		}
	);

	it.each(['backup', 'forget', 'prune', 'unlock', 'migrate', 'repair', 'init', 'restore'])(
		'refuses the forbidden %s operation before spawning Restic',
		async operation => {
			const inspector = new ResticLegacyRepositoryInspector();

			await expect(
				inspector.execute(operation, 'C:\\fixtures\\legacy-restic-repository', 'adapter-test-password')
			).rejects.toMatchObject({ kind: 'forbidden-operation' });
			expect(mockSpawn).not.toHaveBeenCalled();
		}
	);

	it('maps a wrong-password exit without retaining or exposing stderr', async () => {
		const inspector = new ResticLegacyRepositoryInspector();
		const password = 'adapter-test-password';
		const inspectionPromise = inspector.listSnapshots('C:\\fixtures\\legacy-restic-repository', password);

		setImmediate(() => {
			child.stderr.emit('data', Buffer.from(`wrong password: ${password}`));
			child.emit('close', 12);
		});

		await expect(inspectionPromise).rejects.toMatchObject({
			kind: 'wrong-password',
			message: 'Legacy repository inspection failed.',
		});
		await inspectionPromise.catch(error => {
			expect(error).toBeInstanceOf(LegacyRepositoryInspectionError);
			expect((error as Error).message).not.toContain(password);
		});
	});
});
