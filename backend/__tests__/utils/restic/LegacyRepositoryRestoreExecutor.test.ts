import { EventEmitter } from 'events';

jest.mock('child_process');
jest.mock('../../../src/utils/binaryPathResolver');

import { spawn } from 'child_process';
import { getBinaryPath } from '../../../src/utils/binaryPathResolver';
import {
	LegacyRepositoryRestoreError,
	ResticLegacyRepositoryRestoreExecutor,
} from '../../../src/utils/restic/LegacyRepositoryRestoreExecutor';

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;
const mockGetBinaryPath = getBinaryPath as jest.MockedFunction<typeof getBinaryPath>;

describe('ResticLegacyRepositoryRestoreExecutor', () => {
	let child: EventEmitter & {
		stdout: EventEmitter;
		stderr: EventEmitter;
		kill: jest.Mock;
	};

	const request = {
		jobId: 'a'.repeat(24),
		repositoryPath: '/fixtures/legacy-restic-repository',
		password: 'adapter-test-password',
		snapshotId: 'b'.repeat(64),
		selectedPaths: ['app-01/application/index.txt', 'app-01/application/config'],
		stagingPath: '/data/legacy-restores/restore-job-aaaaaaaaaaaaaaaaaaaaaaaa',
	};

	beforeEach(() => {
		jest.clearAllMocks();
		mockGetBinaryPath.mockReturnValue('/test-tools/restic');
		child = Object.assign(new EventEmitter(), {
			stdout: new EventEmitter(),
			stderr: new EventEmitter(),
			kill: jest.fn(),
		});
		mockSpawn.mockReturnValue(child as never);
	});

	it('runs a fixed no-lock granular restore and keeps credentials out of arguments', async () => {
		const executor = new ResticLegacyRepositoryRestoreExecutor();
		const restoring = executor.restoreSnapshot(request);

		setImmediate(() => {
			child.stdout.emit(
				'data',
				Buffer.from(JSON.stringify({ message_type: 'summary', files_restored: 4, bytes_restored: 512 }) + '\n')
			);
			child.emit('close', 0);
		});

		await expect(restoring).resolves.toEqual({ restoredFileCount: 4, restoredBytes: 512 });
		expect(mockSpawn).toHaveBeenCalledWith(
			'/test-tools/restic',
			expect.arrayContaining([
				'--no-lock',
				'--no-cache',
				'--json',
				'restore',
				request.snapshotId,
				'--target',
				request.stagingPath,
				'--overwrite',
				'never',
				'--include',
				'/app-01/application/index.txt',
				'/app-01/application/config',
			]),
			expect.objectContaining({ shell: false, windowsHide: true })
		);
		const args = mockSpawn.mock.calls[0][1] as string[];
		const options = mockSpawn.mock.calls[0][2];
		const environment = options?.env as NodeJS.ProcessEnv;
		expect(args.join(' ')).not.toContain(request.password);
		expect(args).not.toContain('--delete');
		expect(environment.RESTIC_PASSWORD).toBe(request.password);
		expect(environment.RESTIC_PASSWORD_COMMAND).toBeUndefined();
	});

	it('marks a tracked process as cancelled without exposing stderr', async () => {
		const executor = new ResticLegacyRepositoryRestoreExecutor();
		const restoring = executor.restoreSnapshot(request);
		expect(executor.cancel(request.jobId)).toBe(true);
		expect(child.kill).toHaveBeenCalledWith('SIGTERM');

		setImmediate(() => {
			child.stderr.emit('data', Buffer.from(`wrong password: ${request.password}`));
			child.emit('close', 1);
		});

		await expect(restoring).rejects.toMatchObject({ kind: 'cancelled' });
		await restoring.catch(error => {
			expect(error).toBeInstanceOf(LegacyRepositoryRestoreError);
			expect((error as Error).message).not.toContain(request.password);
		});
	});

	it('does not spawn Restic when cancellation arrives before child registration', async () => {
		const executor = new ResticLegacyRepositoryRestoreExecutor();

		expect(executor.cancel(request.jobId)).toBe(false);
		await expect(executor.restoreSnapshot(request)).rejects.toMatchObject({ kind: 'cancelled' });
		expect(mockSpawn).not.toHaveBeenCalled();
	});
});
