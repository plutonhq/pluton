import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import {
	BackupFilesystemError,
	executeFilesystemBackup,
	type BackupFilesystemStageEvent,
} from '../../agent/src/backupFilesystem';

jest.mock('node:child_process', () => ({
	...jest.requireActual('node:child_process'),
	spawn: jest.fn(),
}));

const spawnMock = spawn as jest.MockedFunction<typeof spawn>;
const fixtureSecret = 'synthetic-provider-secret-marker';
const repositoryTarget = 'pluton:managed-repositories/example';
const resticRepository = `rclone:${repositoryTarget}`;

// Mock only process I/O, not the handler: this exercises the real target probe,
// init decision, safe diagnostics, and credential cleanup on Windows and Linux.
describe('agent managed repository target check', () => {
	let root: string;
	let source: string;
	let dataDir: string;
	let binDir: string;
	let listing: { code: number | null; stdout: string; stderr: string };
	let stages: BackupFilesystemStageEvent[];
	let configProbe: { code: number; stdout: string; stderr: string };

	beforeEach(async () => {
		root = await mkdtemp(path.join(tmpdir(), 'pluton-target-test-'));
		source = path.join(root, 'source');
		dataDir = path.join(root, 'state');
		binDir = path.join(root, 'bin');
		await Promise.all([mkdir(source), mkdir(dataDir), mkdir(binDir)]);
		await Promise.all(
			['restic', 'rclone'].map(binary => writeFile(path.join(binDir, binary), '', { mode: 0o755 }))
		);
		listing = { code: 0, stdout: '', stderr: '' };
		stages = [];
		configProbe = {
			code: 0,
			stdout: JSON.stringify({ version: 2, id: 'c'.repeat(64) }),
			stderr: '',
		};
		spawnMock.mockReset();
		spawnMock.mockImplementation((binary: any, args: any) => {
			const child = Object.assign(new EventEmitter(), {
				stdin: new PassThrough(),
				stdout: new PassThrough(),
				stderr: new PassThrough(),
				exitCode: null,
				killed: false,
			});
			let result = { code: 0 as number | null, stdout: '', stderr: '' };
			if (path.basename(binary) === 'rclone' && args[0] === 'obscure') {
				result.stdout = 'obscured-test-value\n';
			} else if (path.basename(binary) === 'rclone') {
				expect(args).toEqual(['lsf', repositoryTarget]);
				result = listing;
			} else if (args.includes('snapshots')) {
				result.code = 1;
			} else if (args.includes('cat')) {
				expect(args).toEqual(['-r', resticRepository, '--no-lock', 'cat', 'config']);
				result = configProbe;
			} else if (args.includes('backup')) {
				result.stdout = `${JSON.stringify({ message_type: 'summary', snapshot_id: 'abcdef0123456789' })}\n`;
			}
			queueMicrotask(() => {
				child.stdout.emit('data', Buffer.from(result.stdout));
				// Split diagnostics to exercise the bounded classifier across chunks.
				const midpoint = Math.floor(result.stderr.length / 2);
				child.stderr.emit('data', Buffer.from(result.stderr.slice(0, midpoint)));
				child.stderr.emit('data', Buffer.from(result.stderr.slice(midpoint)));
				child.emit('close', result.code);
			});
			return child as any;
		});
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	function execute() {
		return executeFilesystemBackup({
			payload: {
				version: 1,
				backupId: 'backup-01',
				planId: 'plan-01',
				sourcePath: source,
				excludes: [],
				repository: {
					remoteName: 'pluton',
					path: 'managed-repositories/example',
					initialize: true,
				},
				rclone: {
					type: 'sftp',
					options: { host: 'sftp.example.internal', user: 'backup-user', pass: fixtureSecret },
				},
				repositoryPassword: 'test-only-repository-password-value',
			},
			config: {
				serverUrl: new URL('https://example.invalid'),
				dataDir,
				binDir,
				allowedRoots: [source],
				allowInsecureHttp: false,
			},
			allowedRoots: [source],
			shouldCancel: async () => false,
			onEvent: async () => undefined,
			onStage: event => stages.push(event),
		});
	}

	function resticCalls(): string[][] {
		return spawnMock.mock.calls
			.filter(call => path.basename(call[0]) === 'restic')
			.map(call => call[1] as string[]);
	}

	async function expectCleanup() {
		expect((await readdir(dataDir)).filter(name => name.startsWith('rclone-'))).toEqual([]);
		for (const call of spawnMock.mock.calls) {
			expect(call[2]).toEqual(expect.objectContaining({ shell: false }));
		}
		expect(JSON.stringify(stages)).not.toContain(fixtureSecret);
	}

	it.each([
		{
			name: 'missing',
			code: 3,
			stderr: 'Failed to lsf: directory not found',
			outcome: 'target-not-found',
		},
		{ name: 'empty', code: 0, stderr: '', outcome: 'target-empty' },
	])('allows a $name destination and initializes the exact plan path', async scenario => {
		listing = { code: scenario.code, stdout: '', stderr: scenario.stderr };
		await expect(execute()).resolves.toMatchObject({ snapshotId: 'abcdef0123456789' });
		expect(stages).toContainEqual({ stage: 'repository-target-check', message: scenario.outcome });
		expect(resticCalls()).toContainEqual(['-r', resticRepository, 'init']);
		expect(resticCalls().some(args => args.includes('backup'))).toBe(true);
		expect(resticCalls()).toContainEqual(['-r', resticRepository, '--no-lock', 'cat', 'config']);
		await expectCleanup();
	});

	it.each(['repo/\n', 'config\n', ' \n', '\n'])(
		'refuses init for any non-empty listing: %j',
		async stdout => {
			listing.stdout = stdout;
			await expect(execute()).rejects.toMatchObject({
				stage: 'repository-target-check',
				code: 'repository-target-not-empty',
			});
			expect(resticCalls().some(args => args.includes('init') || args.includes('backup'))).toBe(
				false
			);
			await expectCleanup();
		}
	);

	it.each([
		{
			name: 'SSH authentication',
			code: 1,
			stderr:
				'ssh: handshake failed: ssh: unable to authenticate, attempted methods [none password], no supported methods remain',
			expected: 'target-check-auth-failed',
		},
		{
			name: 'permission',
			code: 1,
			stderr: 'error listing target: permission denied',
			expected: 'target-check-access-failed',
		},
		{
			name: 'transport',
			code: 1,
			stderr: 'dial tcp: connection refused',
			expected: 'target-check-transport-failed',
		},
		{
			name: 'malformed config',
			code: 1,
			stderr: 'config section not found',
			expected: 'repository-target-check-failed',
		},
		{ name: 'usage', code: 2, stderr: 'unknown flag', expected: 'repository-target-check-failed' },
		{
			name: 'file not found',
			code: 4,
			stderr: 'file not found',
			expected: 'repository-target-check-failed',
		},
		{
			name: 'unknown missing-path text',
			code: 1,
			stderr: 'directory/path not found',
			expected: 'repository-target-check-failed',
		},
		{
			name: 'signalled process',
			code: null,
			stderr: '',
			expected: 'repository-target-check-failed',
		},
		{
			name: 'contradictory permission failure',
			code: 3,
			stderr: 'permission denied',
			expected: 'target-check-access-failed',
		},
	])('refuses init on $name errors without exposing provider text', async scenario => {
		listing = { code: scenario.code, stdout: '', stderr: `${scenario.stderr}: ${fixtureSecret}` };
		const error: unknown = await execute().catch(error => error);
		expect(error).toMatchObject({
			name: 'BackupFilesystemError',
			stage: 'repository-target-check',
			code: scenario.expected,
		});
		expect(error).toBeInstanceOf(BackupFilesystemError);
		expect(`${(error as Error).message}${JSON.stringify(error)}`).not.toContain(fixtureSecret);
		expect(resticCalls().some(args => args.includes('init') || args.includes('backup'))).toBe(
			false
		);
		expect(
			stages.some(event => event.message === 'target-not-found' || event.message === 'target-empty')
		).toBe(false);
		await expectCleanup();
	});

	it('refuses partial listing output even with a directory-not-found exit', async () => {
		listing = { code: 3, stdout: 'repo/\n', stderr: 'directory not found' };
		await expect(execute()).rejects.toMatchObject({ code: 'repository-target-not-empty' });
		expect(resticCalls().some(args => args.includes('init') || args.includes('backup'))).toBe(
			false
		);
		await expectCleanup();
	});
});
