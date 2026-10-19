import { spawn } from 'child_process';
import crypto from 'crypto';
import path from 'path';
import { z } from 'zod';
import { getBinaryPath } from '../binaryPathResolver';
import { processManager } from '../../managers/ProcessManager';
import { fullSnapshotId, type ManagedSftpAccess } from './ManagedSftpRepositorySession';
import type { DatabaseArtifact } from '../../types/remoteLifecycle';

export class ManagedReplicationError extends Error {
	constructor(public readonly code: string) {
		super(`Managed replication failed (${code}).`);
	}
}

export type ReplicationSnapshot = {
	id: string;
	tree: string;
	tags: string[];
	paths: string[];
	original?: string;
};
export type ReplicationSource = {
	access: ManagedSftpAccess;
	planId: string;
	backupId: string;
	snapshotId: string;
	artifacts: Pick<DatabaseArtifact, 'path' | 'bytes' | 'sha256'>[];
};
export type ReplicationDestinationAccess = {
	options: Record<string, string>;
	repositoryPath: string;
	environment?: Record<string, string>;
};
export type ReplicationSourceProof = { repositoryConfigId: string; snapshot: ReplicationSnapshot };
export type ReplicationDestinationState = {
	repositoryConfigId: string | null;
	initialization: 'uninitialized' | 'initializing' | 'ready' | 'uncertain';
};
export interface ManagedReplicationExecutorContract {
	inspectSource(source: ReplicationSource, signal?: AbortSignal): Promise<ReplicationSourceProof>;
	copy(input: {
		source: ReplicationSource;
		proof: ReplicationSourceProof;
		destination: ReplicationDestinationAccess;
		state: ReplicationDestinationState;
		beginInitialization(): Promise<void>;
		bindRepository(repositoryConfigId: string): Promise<void>;
		signal?: AbortSignal;
	}): Promise<{ snapshotId: string; repositoryConfigId: string }>;
}

const snapshotSchema = z.object({
	id: fullSnapshotId,
	tree: fullSnapshotId,
	tags: z.array(z.string()),
	paths: z.array(z.string()),
	original: fullSnapshotId.optional(),
});
const configSchema = z.object({ id: fullSnapshotId });
const hasControlCharacters = (value: string) =>
	Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);

/** A fixed server-only workflow. Never executes repair, unlock, prune or purge. */
export class ManagedReplicationExecutor implements ManagedReplicationExecutorContract {
	async inspectSource(
		source: ReplicationSource,
		signal?: AbortSignal
	): Promise<ReplicationSourceProof> {
		this.assertSource(source);
		const env = await this.environment(source.access, undefined, signal);
		const repositoryConfigId = this.parse(
			configSchema,
			await this.restic('source', source.access.repositoryPath, ['cat', 'config'], env, signal)
		).id;
		const rows = this.parse(
			z.array(snapshotSchema),
			await this.restic(
				'source',
				source.access.repositoryPath,
				['snapshots', source.snapshotId],
				env,
				signal
			)
		);
		if (rows.length !== 1 || rows[0].id !== source.snapshotId)
			throw new ManagedReplicationError('snapshot-unavailable');
		this.assertSnapshot(source, rows[0]);
		await this.verifyArtifacts(
			source,
			'source',
			source.access.repositoryPath,
			source.snapshotId,
			env,
			signal
		);
		return { repositoryConfigId, snapshot: rows[0] };
	}

	async copy(input: Parameters<ManagedReplicationExecutorContract['copy']>[0]) {
		const { source, proof, destination, state, signal } = input;
		this.assertSource(source);
		this.assertSnapshot(source, proof.snapshot);
		if (
			!fullSnapshotId.safeParse(proof.repositoryConfigId).success ||
			!fullSnapshotId.safeParse(proof.snapshot.tree).success
		)
			throw new ManagedReplicationError('source-binding-changed');
		if (state.initialization === 'initializing' || state.initialization === 'uncertain')
			throw new ManagedReplicationError('initialization-uncertain');
		if (
			state.initialization === 'ready' &&
			!fullSnapshotId.safeParse(state.repositoryConfigId).success
		)
			throw new ManagedReplicationError('destination-unowned');
		const env = await this.environment(source.access, destination, signal);
		const actualSource = await this.inspectSource(source, signal);
		if (JSON.stringify(actualSource) !== JSON.stringify(proof))
			throw new ManagedReplicationError('source-binding-changed');
		let repositoryConfigId: string;
		try {
			repositoryConfigId = this.parse(
				configSchema,
				await this.restic('destination', destination.repositoryPath, ['cat', 'config'], env, signal)
			).id;
		} catch (error) {
			if (
				!(error instanceof ManagedReplicationError) ||
				error.code !== 'repository-unavailable' ||
				state.initialization !== 'uninitialized' ||
				state.repositoryConfigId
			)
				throw error;
			// A missing config alone is not ownership: refuse any pre-existing objects.
			const listing = await this.command(
				'rclone',
				['lsf', `destination:${destination.repositoryPath}`, '--max-depth', '1'],
				env,
				signal
			);
			if (listing.trim()) throw new ManagedReplicationError('destination-not-empty');
			await input.beginInitialization(); // durable BEFORE any destination mutation
			await this.restic(
				'destination',
				destination.repositoryPath,
				[
					'init',
					'--from-repo',
					`rclone:source:${source.access.repositoryPath}`,
					'--copy-chunker-params',
				],
				env,
				signal,
				true
			);
			repositoryConfigId = this.parse(
				configSchema,
				await this.restic('destination', destination.repositoryPath, ['cat', 'config'], env, signal)
			).id;
			await input.bindRepository(repositoryConfigId); // durable BEFORE copy
		}
		if (state.repositoryConfigId !== repositoryConfigId && state.repositoryConfigId !== null)
			throw new ManagedReplicationError('destination-binding-changed');
		// Never adopt an unknown existing repository, even with the right password.
		if (state.initialization === 'uninitialized' && state.repositoryConfigId === null) {
			// bindRepository must have followed our empty-prefix initialization above.
			if (!this.initializedInThisCall.has(env))
				throw new ManagedReplicationError('destination-unowned');
		}
		await this.restic(
			'destination',
			destination.repositoryPath,
			['copy', '--from-repo', `rclone:source:${source.access.repositoryPath}`, source.snapshotId],
			env,
			signal,
			true
		);
		const copies = this.parse(
			z.array(snapshotSchema),
			await this.restic(
				'destination',
				destination.repositoryPath,
				[
					'snapshots',
					'--tag',
					`pluton-plan-${source.planId}`,
					'--tag',
					`pluton-backup-${source.backupId}`,
				],
				env,
				signal
			)
		);
		const matched = copies.filter(
			snapshot =>
				(snapshot.id === source.snapshotId || snapshot.original === source.snapshotId) &&
				snapshot.tree === proof.snapshot.tree &&
				JSON.stringify([...snapshot.paths].sort()) ===
					JSON.stringify([...proof.snapshot.paths].sort())
		);
		if (matched.length !== 1) throw new ManagedReplicationError('destination-snapshot-unverified');
		this.assertSnapshot(source, matched[0], false);
		await this.verifyArtifacts(
			source,
			'destination',
			destination.repositoryPath,
			matched[0].id,
			env,
			signal
		);
		return { snapshotId: matched[0].id, repositoryConfigId };
	}

	private readonly initializedInThisCall = new WeakSet<NodeJS.ProcessEnv>();

	private assertSource(source: ReplicationSource) {
		if (
			!fullSnapshotId.safeParse(source.snapshotId).success ||
			!/^[A-Za-z0-9_-]+$/.test(source.planId) ||
			!/^[A-Za-z0-9_-]+$/.test(source.backupId)
		)
			throw new ManagedReplicationError('source-binding-invalid');
		for (const artifact of source.artifacts) {
			if (
				!/^\/pluton\/database\/[A-Za-z0-9_.-]+\.sql$/.test(artifact.path) ||
				!Number.isSafeInteger(artifact.bytes) ||
				artifact.bytes <= 0 ||
				!/^[a-f0-9]{64}$/.test(artifact.sha256)
			)
				throw new ManagedReplicationError('artifact-binding-invalid');
		}
	}

	private assertSnapshot(source: ReplicationSource, snapshot: ReplicationSnapshot, exact = true) {
		const planTags = snapshot.tags.filter(tag => tag.startsWith('pluton-plan-'));
		const backupTags = snapshot.tags.filter(tag => tag.startsWith('pluton-backup-'));
		if (
			(exact && snapshot.id !== source.snapshotId) ||
			planTags.length !== 1 ||
			backupTags.length !== 1 ||
			planTags[0] !== `pluton-plan-${source.planId}` ||
			backupTags[0] !== `pluton-backup-${source.backupId}`
		)
			throw new ManagedReplicationError('snapshot-binding-mismatch');
	}

	private async verifyArtifacts(
		source: ReplicationSource,
		remote: string,
		repository: string,
		snapshot: string,
		env: NodeJS.ProcessEnv,
		signal?: AbortSignal
	) {
		for (const artifact of source.artifacts) {
			const hash = crypto.createHash('sha256');
			let bytes = 0;
			await this.command(
				'restic',
				this.args(remote, repository, ['dump', snapshot, artifact.path], false),
				env,
				signal,
				undefined,
				true,
				chunk => {
					bytes += chunk.length;
					if (bytes > artifact.bytes) throw new ManagedReplicationError('artifact-size-mismatch');
					hash.update(chunk);
				}
			);
			if (bytes !== artifact.bytes || hash.digest('hex') !== artifact.sha256)
				throw new ManagedReplicationError('artifact-checksum-mismatch');
		}
	}

	private args(
		remote: string,
		repository: string,
		command: string[],
		json = true,
		mutating = false
	) {
		return [
			...(!mutating ? ['--no-lock'] : []),
			'--no-cache',
			...(json ? ['--json'] : []),
			'--repo',
			`rclone:${remote}:${repository}`,
			'-o',
			`rclone.program=${getBinaryPath('rclone')}`,
			...command,
		];
	}
	private async restic(
		remote: string,
		repository: string,
		args: string[],
		env: NodeJS.ProcessEnv,
		signal?: AbortSignal,
		mutating = false
	) {
		const result = await this.command(
			'restic',
			this.args(remote, repository, args, true, mutating),
			env,
			signal,
			undefined,
			mutating,
			mutating ? () => undefined : undefined
		);
		if (args[0] === 'init') this.initializedInThisCall.add(env);
		return result;
	}

	private async environment(
		source: ManagedSftpAccess,
		destination?: ReplicationDestinationAccess,
		signal?: AbortSignal
	) {
		if (
			!source.password ||
			!source.repositoryPath ||
			source.repositoryPath.includes('\\') ||
			source.repositoryPath.split('/').includes('..') ||
			hasControlCharacters(source.repositoryPath) ||
			Object.values(source.options).some(hasControlCharacters) ||
			Object.keys(source.options).some(key => !['host', 'port', 'user', 'pass'].includes(key)) ||
			!source.options.host ||
			!source.options.user ||
			!source.options.pass
		)
			throw new ManagedReplicationError('source-configuration-invalid');
		const env: NodeJS.ProcessEnv = {
			GOMAXPROCS: '2',
			GOMEMLIMIT: '256MiB',
			RCLONE_TRANSFERS: '2',
			RCLONE_BUFFER_SIZE: '4M',
			RCLONE_MULTI_THREAD_STREAMS: '0',
			RCLONE_CONFIG: process.platform === 'win32' ? 'NUL' : '/dev/null',
		};
		for (const key of ['PATH', 'SYSTEMROOT', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR'])
			if (process.env[key]) env[key] = process.env[key];
		const obscured = (
			await this.command('rclone', ['obscure', '-'], env, signal, `${source.options.pass}\n`)
		).trim();
		if (!/^[A-Za-z0-9_-]+$/.test(obscured))
			throw new ManagedReplicationError('credentials-unavailable');
		for (const [key, value] of Object.entries({ type: 'sftp', ...source.options, pass: obscured }))
			env[`RCLONE_CONFIG_SOURCE_${key.toUpperCase()}`] = value;
		if (destination) {
			if (
				!destination.repositoryPath ||
				destination.repositoryPath.split('/').includes('..') ||
				destination.repositoryPath.includes('\\') ||
				hasControlCharacters(destination.repositoryPath) ||
				destination.options.type !== 's3'
			)
				throw new ManagedReplicationError('destination-configuration-invalid');
			for (const [key, value] of Object.entries(destination.options)) {
				if (!/^[a-z0-9_]+$/.test(key) || hasControlCharacters(value))
					throw new ManagedReplicationError('destination-configuration-invalid');
				env[`RCLONE_CONFIG_DESTINATION_${key.toUpperCase()}`] = value;
			}
			for (const [key, value] of Object.entries(destination.environment || {})) {
				if (!['SSL_CERT_FILE', 'RCLONE_CA_CERT'].includes(key) || !path.isAbsolute(value))
					throw new ManagedReplicationError('destination-configuration-invalid');
				env[key] = value;
			}
		}
		env.RESTIC_PASSWORD = source.password;
		env.RESTIC_FROM_PASSWORD = source.password;
		return env;
	}

	private parse<T>(schema: z.ZodType<T>, output: string): T {
		try {
			return schema.parse(JSON.parse(output));
		} catch {
			throw new ManagedReplicationError('invalid-output');
		}
	}

	private command(
		binary: 'restic' | 'rclone',
		args: string[],
		env: NodeJS.ProcessEnv,
		signal?: AbortSignal,
		input?: string,
		long = false,
		stream?: (chunk: Buffer) => void
	): Promise<string> {
		if (
			process.platform === 'win32' &&
			binary === 'restic' &&
			(args.includes('copy') || args.includes('init'))
		)
			return Promise.reject(new ManagedReplicationError('platform-not-supported'));
		const executable = getBinaryPath(binary);
		if (!path.isAbsolute(executable))
			return Promise.reject(new ManagedReplicationError('binary-unavailable'));
		if (signal?.aborted) return Promise.reject(new ManagedReplicationError('cancelled'));
		return new Promise((resolve, reject) => {
			const child = spawn(executable, args, {
				env,
				shell: false,
				windowsHide: true,
				detached: process.platform !== 'win32',
				stdio: ['pipe', 'pipe', 'pipe'],
			});
			const key = `managed-replication-${crypto.randomUUID()}`;
			processManager.trackProcess(key, child);
			let output = '';
			let diagnostic = Buffer.alloc(0);
			let bytes = 0;
			let failure: string | undefined;
			const stop = (code: string) => {
				failure ||= code;
				if (process.platform === 'win32') {
					failure = 'execution-uncertain';
					child.kill('SIGKILL');
				} else if (child.pid) {
					try {
						process.kill(-child.pid, 'SIGKILL');
					} catch (error) {
						if ((error as NodeJS.ErrnoException).code !== 'ESRCH') failure = 'execution-uncertain';
					}
				}
			};
			const abort = () => stop('cancelled');
			signal?.addEventListener('abort', abort, { once: true });
			const timer = setTimeout(() => stop('timeout'), long ? 30 * 60_000 : 60_000);
			child.on('error', () => {
				failure ||= 'execution-failed';
			});
			child.stdin?.on('error', () => {
				failure ||= 'execution-failed';
			});
			child.stdin?.end(input);
			child.stdout?.on('data', (chunk: Buffer) => {
				try {
					if (stream) stream(chunk);
					else {
						bytes += chunk.length;
						if (bytes > 4 * 1024 * 1024) stop('output-limit');
						else output += chunk.toString();
					}
				} catch (error) {
					stop(error instanceof ManagedReplicationError ? error.code : 'execution-failed');
				}
			});
			// Private bounded classification only; never return or log raw diagnostics.
			child.stderr?.on('data', (chunk: Buffer) => {
				diagnostic = Buffer.concat([diagnostic, chunk]).subarray(-32 * 1024);
			});
			child.once('close', async code => {
				clearTimeout(timer);
				signal?.removeEventListener('abort', abort);
				// Do not release a durable repository claim before all descendants stop.
				if (process.platform !== 'win32' && child.pid && !(await this.stopDescendants(child.pid)))
					failure = 'execution-uncertain';
				processManager.untrackProcess(key);
				if (failure || code !== 0)
					reject(
						new ManagedReplicationError(failure || this.failureCode(code, diagnostic.toString()))
					);
				else resolve(output.trim());
			});
		});
	}

	private failureCode(exitCode: number | null, diagnostic: string) {
		if (exitCode === 12) return 'wrong-password';
		if (
			/x509|certificate (?:verify|verification|signed|is not|has expired)|tls handshake|hostname.*(?:mismatch|certificate)/i.test(
				diagnostic
			)
		)
			return 'storage-tls-failed';
		if (
			/SignatureDoesNotMatch|InvalidAccessKey|InvalidToken|ExpiredToken|invalid credentials/i.test(
				diagnostic
			)
		)
			return 'storage-authentication-failed';
		if (
			/(?:object.?lock|retention|compliance)/i.test(diagnostic) &&
			/(?:delet|denied|forbidden|403)/i.test(diagnostic)
		)
			return 'retention-denied';
		if (/AccessDenied|Forbidden|(?:status|http|response)[^\r\n]{0,20}\b403\b/i.test(diagnostic))
			return 'storage-access-denied';
		return exitCode === 10
			? 'repository-unavailable'
			: exitCode === 11
				? 'repository-locked'
				: 'execution-failed';
	}

	/** A failed process-group check retains the durable lock; no PID/age guess. */
	private async stopDescendants(pid: number): Promise<boolean> {
		try {
			process.kill(-pid, 'SIGKILL');
		} catch (error) {
			return (error as NodeJS.ErrnoException).code === 'ESRCH';
		}
		for (let count = 0; count < 80; count += 1) {
			try {
				process.kill(-pid, 0);
			} catch (error) {
				return (error as NodeJS.ErrnoException).code === 'ESRCH';
			}
			await new Promise(resolve => setTimeout(resolve, 25));
		}
		return false;
	}
}
