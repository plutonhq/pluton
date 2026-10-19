import crypto from 'crypto';
import { constants } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import type { RecoveryImportLease } from '../db/schema/recoveryTests';
import type { RecoveryTestStore } from '../stores/RecoveryTestStore';
import type { RecoveryDatabaseResult, RecoveryTarget, RecoveryStage } from '../types/recoveryTests';
import { recoveryTargetSchema, parseRecoveryInput } from './recoveryTestPolicy';
import { detectRecoveryClient, recoveryTrustFile } from './recoveryDatabaseClients';
import { runRecoveryProcess, type RecoveryProcessInput } from './recoveryProcess';
import { checkRecoveryCancellation, RecoveryTestError } from './recoveryValidation';
import { checkRecoveryDumpCompatibility } from './recoveryDumpCompatibility';

const GUARD = 'pluton_recovery_guard';
const OWNER = '__pluton_recovery_owner';
const PURPOSE = 'pluton-phase6-recovery-only';
const quote = (value: string) =>
	`"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\t', '\\t')}"`;
const pgpass = (value: string) => value.replaceAll('\\', '\\\\').replaceAll(':', '\\:');
const identifier = (value: string) => {
	if (
		!/^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/.test(value) ||
		[
			'mysql',
			'information_schema',
			'performance_schema',
			'sys',
			'postgres',
			'template0',
			'template1',
			GUARD,
		].includes(value.toLowerCase())
	)
		throw new RecoveryTestError('database-target-preflight', 'recovery-target-unsafe');
	return value;
};

/** mysql grants are inspected, not logged. Reject global/role/FILE/SUPER/admin scope. */
export function assertRecoveryMysqlGrants(
	output: string,
	allowedDatabases: string[],
	purpose: 'recovery' | 'persistent' = 'recovery'
) {
	const guardDatabase = purpose === 'persistent' ? 'pluton_restore_guard' : GUARD;
	const guardTable = purpose === 'persistent' ? 'contract' : 'pluton_recovery_guard';
	const lines = output.trim().split(/\r?\n/);
	if (!lines.length)
		throw new RecoveryTestError('database-target-preflight', 'recovery-target-unsafe');
	for (const line of lines) {
		if (/WITH GRANT OPTION/i.test(line))
			throw new RecoveryTestError('database-target-preflight', 'recovery-target-unsafe');
		const grant = /^GRANT (.+?) ON (.+?) TO /i.exec(line);
		if (!grant) throw new RecoveryTestError('database-target-preflight', 'recovery-target-unsafe');
		if (grant[2] === '*.*' && grant[1] === 'USAGE') continue;
		const scope = /^`((?:[^`]|``)+)`\.\*$/.exec(grant[2]);
		const guard =
			grant[2] === `\`${guardDatabase}\`.\`${guardTable}\`` ||
			grant[2] === `\`${guardDatabase}\`.*`;
		if (guard && grant[1] === 'SELECT') continue;
		if (
			!scope ||
			/(?<!\\)[_%]/.test(scope[1]) ||
			!allowedDatabases.includes(scope[1].replace(/\\([_%])/g, '$1'))
		)
			throw new RecoveryTestError('database-target-preflight', 'recovery-target-unsafe');
		if (
			grant[1] !== 'ALL PRIVILEGES' &&
			grant[1]
				.split(/,\s*/)
				.some(
					privilege =>
						![
							'SELECT',
							'INSERT',
							'UPDATE',
							'DELETE',
							'CREATE',
							'DROP',
							'INDEX',
							'ALTER',
							'CREATE TEMPORARY TABLES',
							'LOCK TABLES',
							'EXECUTE',
							'CREATE VIEW',
							'SHOW VIEW',
							'CREATE ROUTINE',
							'ALTER ROUTINE',
							'EVENT',
							'TRIGGER',
							'REFERENCES',
						].includes(privilege)
				)
		)
			throw new RecoveryTestError('database-target-preflight', 'recovery-target-unsafe');
	}
}

/** Do not alter SQL or rewrite database names. Replace only pg_dump's transport envelope
 * with a fresh unpredictable native \restrict key, so archived meta-commands cannot
 * escape using the old visible key. SQL/COPY bytes are streamed unchanged. */
export async function postgresRecoveryInput(file: string): Promise<Readable> {
	const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const stat = await handle.stat();
		const head = Buffer.alloc(Math.min(stat.size, 64 * 1024));
		await handle.read(head, 0, head.length, 0);
		let start = 0,
			end = stat.size - 1;
		const envelope = /^(?:(?:--[^\r\n]*(?:\r?\n|$))|\s)*\\restrict ([A-Za-z0-9]+)\r?\n/.exec(
			head.toString('utf8')
		);
		if (envelope) {
			start = Buffer.byteLength(envelope[0]);
			const tailPosition = Math.max(start, stat.size - 64 * 1024);
			const tail = Buffer.alloc(stat.size - tailPosition);
			await handle.read(tail, 0, tail.length, tailPosition);
			const footer = new RegExp(
				`(?:^|\\n)\\\\unrestrict ${envelope[1]}\\r?\\n(?:(?:--[^\\r\\n]*(?:\\r?\\n|$))|\\s)*$`
			).exec(tail.toString('utf8'));
			if (!footer) throw new RecoveryTestError('database-import', 'database-import-failed');
			end = tailPosition + Buffer.byteLength(tail.toString('utf8').slice(0, footer.index)) - 1;
		}
		const key = crypto.randomBytes(32).toString('hex');
		const source = handle.createReadStream({ start, end: Math.max(start, end), autoClose: true });
		const stream = Readable.from(
			(async function* () {
				try {
					yield Buffer.from(`\\restrict ${key}\n`);
					if (end >= start) for await (const chunk of source) yield chunk;
					yield Buffer.from('\n'); // restricted until EOF; no unrestrict in argv or archived key
				} finally {
					source.destroy();
					await handle.close();
				}
			})()
		);
		stream.once('close', () => source.destroy()); // even if import stops before reading
		return stream;
	} catch (error) {
		await handle.close();
		throw error;
	}
}

type ImportStore = Pick<RecoveryTestStore, 'addLease' | 'removeLease' | 'leases' | 'leaseTarget'>;
type RunProcess = (input: RecoveryProcessInput) => Promise<string>;
export class RecoveryDatabaseImporter {
	constructor(
		private readonly store: ImportStore,
		private readonly run: RunProcess = runRecoveryProcess,
		private readonly client = detectRecoveryClient,
		private readonly trust: () => string | Promise<string> = recoveryTrustFile
	) {}

	protected async connection(target: RecoveryTarget, directory: string, signal: AbortSignal) {
		const parsed = parseRecoveryInput(recoveryTargetSchema, target);
		if (!parsed.password)
			throw new RecoveryTestError('database-target-preflight', 'recovery-target-not-configured');
		const binary = this.client(target.engine);
		const postgres = target.engine === 'postgresql';
		const ca = target.tls === 'verify-identity' ? await this.trust() : undefined;
		const credentials = path.join(
			directory,
			`credentials-${crypto.randomBytes(12).toString('hex')}.${postgres ? 'pgpass' : 'cnf'}`
		);
		const home = path.join(directory, `client-${crypto.randomBytes(12).toString('hex')}`);
		await fs.mkdir(home, { mode: 0o700 });
		await fs.writeFile(
			credentials,
			postgres
				? `${pgpass(target.host)}:${target.port}:*:${pgpass(target.username)}:${pgpass(target.password)}\n`
				: `[client]\nprotocol=tcp\nhost=${quote(target.host)}\nport=${target.port}\nuser=${quote(target.username)}\npassword=${quote(target.password)}\n` +
						(target.tls === 'verify-identity'
							? `${target.engine === 'mysql' ? 'ssl-mode=VERIFY_IDENTITY\n' : 'ssl=ON\nssl-verify-server-cert=ON\n'}ssl-ca=${quote(ca!)}\n`
							: target.engine === 'mysql'
								? 'ssl-mode=DISABLED\n'
								: 'ssl=OFF\n'),
			{ flag: 'wx', mode: 0o600 }
		);
		await fs.chmod(credentials, 0o600);
		const env: NodeJS.ProcessEnv = {
			PATH: '/usr/bin:/bin',
			LANG: 'C',
			LC_ALL: 'C',
			HOME: home,
			TMPDIR: directory,
			PAGER: '/bin/false',
			EDITOR: '/bin/false',
			VISUAL: '/bin/false',
			MYSQL_TEST_LOGIN_FILE: path.join(home, '.mylogin.cnf'),
		};
		if (postgres)
			Object.assign(env, {
				PGPASSFILE: credentials,
				PGSSLMODE: target.tls === 'local' ? 'disable' : 'verify-full',
				PGGSSENCMODE: 'disable',
				PGCONNECT_TIMEOUT: '10',
				...(ca ? { PGSSLROOTCERT: ca } : {}),
			});
		const base = postgres
			? [
					'-X',
					'--no-password',
					'--quiet',
					'--no-psqlrc',
					'--host',
					target.host,
					'--port',
					String(target.port),
					'--username',
					target.username,
					'--set',
					'ON_ERROR_STOP=1',
					'--pset',
					'pager=off',
					'--tuples-only',
					'--no-align',
				]
			: [
					`--defaults-file=${credentials}`,
					'--batch',
					'--raw',
					'--skip-column-names',
					'--binary-mode',
					'--local-infile=0',
					'--skip-reconnect',
					'--connect-timeout=10',
					...(target.engine === 'mariadb' ? ['--sandbox'] : []),
				];
		const query = (
			database: string,
			input: string | Readable,
			stage: RecoveryStage,
			capture = true,
			timeoutMs = 60_000,
			querySignal = signal
		) =>
			this.run({
				binary,
				args: [
					...base,
					...(postgres ? ['--dbname', database] : database ? [`--database=${database}`] : []),
				],
				env,
				cwd: home,
				input,
				signal: querySignal,
				stage,
				capture,
				timeoutMs,
			});
		return {
			query,
			close: async () => {
				await fs.rm(credentials, { force: true });
				await fs.rm(home, { recursive: true, force: true });
			},
		};
	}

	private async owner(
		query: Awaited<ReturnType<RecoveryDatabaseImporter['connection']>>['query'],
		database: string,
		stage: RecoveryStage
	) {
		return (await query(database, `SELECT owner_token FROM ${OWNER};`, stage)).trim();
	}
	async importDatabase(input: {
		testId: string;
		targetId: string;
		target: RecoveryTarget;
		entry: RecoveryDatabaseResult;
		file: string;
		directory: string;
		signal: AbortSignal;
		allowedDatabases: string[];
		stage: (value: RecoveryStage) => void;
	}) {
		const { entry, target, signal, stage } = input;
		if (!entry.engine || !entry.database)
			throw new RecoveryTestError('database-target-preflight', 'database-metadata-incomplete');
		if (target.engine !== entry.engine)
			throw new RecoveryTestError('database-target-preflight', 'recovery-target-unsafe');
		const postgres = target.engine === 'postgresql';
		const database = postgres
			? `pluton_rt_${crypto.randomBytes(12).toString('hex')}`
			: identifier(entry.database);
		stage('database-target-preflight');
		let connection: Awaited<ReturnType<RecoveryDatabaseImporter['connection']>> | undefined;
		try {
			connection = await this.connection(target, input.directory, signal);
			const query = connection.query;
			if (
				(
					await query(
						GUARD,
						'SELECT purpose FROM pluton_recovery_guard;',
						'database-target-preflight'
					)
				).trim() !== PURPOSE
			)
				throw new RecoveryTestError('database-target-preflight', 'recovery-target-unsafe');
			if (postgres) {
				const unsafe = await query(
					'postgres',
					'SELECT count(*) FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolcreaterole OR rolreplication OR rolbypassrls); SELECT count(*) FROM pg_auth_members WHERE member = (SELECT oid FROM pg_roles WHERE rolname = current_user);',
					'database-target-preflight'
				);
				if (unsafe.trim() !== '0\n0')
					throw new RecoveryTestError('database-target-preflight', 'recovery-target-unsafe');
			} else
				assertRecoveryMysqlGrants(
					await query('', 'SHOW GRANTS;', 'database-target-preflight'),
					input.allowedDatabases
				);
			entry.versionValidation = await checkRecoveryDumpCompatibility(
				target.engine,
				input.file,
				await query(
					postgres ? 'postgres' : '',
					postgres ? 'SHOW server_version;' : 'SELECT VERSION();',
					'database-target-preflight'
				)
			);
			const existing = (
				await query(
					postgres ? 'postgres' : '',
					postgres ? 'SELECT datname FROM pg_database;' : 'SHOW DATABASES;',
					'database-target-preflight'
				)
			)
				.trim()
				.split(/\r?\n/)
				.filter(Boolean);
			if (existing.includes(database))
				throw new RecoveryTestError('database-target-preflight', 'database-already-exists');
			const system = postgres
				? ['postgres', 'template0', 'template1', GUARD]
				: ['mysql', 'information_schema', 'performance_schema', 'sys', GUARD];
			const owned = await this.store.leases(input.testId);
			for (const name of existing.filter(name => !system.includes(name))) {
				const lease = owned.find(row => row.targetId === input.targetId && row.database === name);
				if (
					!lease ||
					(await this.owner(query, name, 'database-target-preflight')) !== lease.ownerToken
				)
					throw new RecoveryTestError('database-target-preflight', 'recovery-target-unsafe');
			}
			checkRecoveryCancellation(signal);
			const lease: RecoveryImportLease = {
				id: crypto.randomBytes(12).toString('hex'),
				testId: input.testId,
				targetId: input.targetId,
				database,
				ownerToken: crypto.randomBytes(24).toString('hex'),
			};
			await this.store.addLease(lease); // durable intention before CREATE; no IF NOT EXISTS
			await query(
				postgres ? 'postgres' : '',
				`CREATE DATABASE ${postgres ? `"${database}"` : `\`${database}\``};`,
				'database-target-preflight'
			);
			await query(
				database,
				`CREATE TABLE ${OWNER} (owner_token VARCHAR(64) NOT NULL); INSERT INTO ${OWNER} VALUES ('${lease.ownerToken}');`,
				'database-target-preflight'
			);
			stage('database-import');
			const handle = postgres
				? undefined
				: await fs.open(input.file, constants.O_RDONLY | constants.O_NOFOLLOW);
			const stream = postgres
				? await postgresRecoveryInput(input.file)
				: handle!.createReadStream({ autoClose: false });
			try {
				await query(database, stream, 'database-import', false, 60 * 60_000);
			} finally {
				stream.destroy();
				await handle?.close();
			}
			stage('database-import-validation');
			const counts = (
				await query(
					database,
					postgres
						? "SELECT count(*) FILTER (WHERE table_type='BASE TABLE'), count(*) FILTER (WHERE table_type='VIEW') FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') AND table_name <> '__pluton_recovery_owner';"
						: "SELECT COALESCE(SUM(TABLE_TYPE='BASE TABLE'),0), COALESCE(SUM(TABLE_TYPE='VIEW'),0) FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME <> '__pluton_recovery_owner';",
					'database-import-validation'
				)
			).trim();
			const parsed = /^(\d+)[|\t](\d+)$/.exec(counts);
			if (
				!parsed ||
				(await this.owner(query, database, 'database-import-validation')) !== lease.ownerToken
			)
				throw new RecoveryTestError(
					'database-import-validation',
					'database-import-validation-failed'
				);
			entry.tables = Number(parsed[1]);
			entry.views = Number(parsed[2]);
			entry.importValidation = 'passed';
		} catch (error) {
			entry.importValidation = 'failed';
			entry.failureCode =
				error instanceof RecoveryTestError ? error.code : 'database-import-failed';
			throw error instanceof RecoveryTestError
				? error
				: new RecoveryTestError('database-import', 'database-import-failed');
		} finally {
			await connection?.close();
		}
	}
	async cleanup(lease: RecoveryImportLease, directory: string, internalConnections = false) {
		const target = await this.store.leaseTarget(lease.targetId);
		if (!target) throw new RecoveryTestError('database-cleanup', 'database-cleanup-failed');
		const controller = new AbortController(); // cancellation does not skip bounded cleanup
		const connection = await this.connection(target, directory, controller.signal);
		try {
			identifier(lease.database);
			const postgres = target.engine === 'postgresql';
			const existing = (
				await connection.query(
					postgres ? 'postgres' : '',
					postgres ? 'SELECT datname FROM pg_database;' : 'SHOW DATABASES;',
					'database-cleanup'
				)
			)
				.trim()
				.split(/\r?\n/);
			if (existing.includes(lease.database)) {
				if (
					(await this.owner(connection.query, lease.database, 'database-cleanup')) !==
					lease.ownerToken
				)
					throw new RecoveryTestError('database-cleanup', 'database-cleanup-failed');
				if (internalConnections) {
					if (
						!lease.targetId.startsWith('irt_') ||
						!postgres ||
						!/^pluton_rt_[a-f0-9]{24}$/.test(lease.database)
					)
						throw new RecoveryTestError('database-cleanup', 'database-cleanup-failed');
					// A killed psql can leave pg_sleep/import's backend alive. Only this role's
					// client sessions in the freshly created, twice ownership-checked DB qualify.
					const stopped = (
						await connection.query(
							'postgres',
							`SELECT pg_terminate_backend(pid,5000) FROM pg_stat_activity WHERE datname='${lease.database}' AND usename=current_user AND backend_type='client backend' AND pid<>pg_backend_pid();`,
							'database-cleanup'
						)
					).trim();
					if (
						(stopped && stopped.split(/\r?\n/).some(value => value !== 't')) ||
						(await this.owner(connection.query, lease.database, 'database-cleanup')) !==
							lease.ownerToken
					)
						throw new RecoveryTestError('database-cleanup', 'database-cleanup-failed');
				}
				await connection.query(
					postgres ? 'postgres' : '',
					`DROP DATABASE ${postgres ? `"${lease.database}"` : `\`${lease.database}\``};`,
					'database-cleanup'
				);
			}
			await this.store.removeLease(lease.id);
		} finally {
			await connection.close();
		}
	}
	/** Internal infrastructure removal additionally requires an empty recovery catalog. */
	async verifyEmptyTarget(target: RecoveryTarget & { id: string }, directory: string) {
		const { id: _id, ...config } = target;
		const connection = await this.connection(config, directory, new AbortController().signal);
		try {
			if (
				(
					await connection.query(
						GUARD,
						'SELECT purpose FROM pluton_recovery_guard;',
						'database-cleanup'
					)
				).trim() !== PURPOSE
			)
				throw new RecoveryTestError('database-cleanup', 'database-cleanup-failed');
			const postgres = target.engine === 'postgresql';
			const catalog = (
				await connection.query(
					postgres ? 'postgres' : '',
					postgres ? 'SELECT datname FROM pg_database;' : 'SHOW DATABASES;',
					'database-cleanup'
				)
			)
				.trim()
				.split(/\r?\n/)
				.filter(Boolean);
			const system = postgres
				? ['postgres', 'template0', 'template1', GUARD]
				: ['mysql', 'information_schema', 'performance_schema', 'sys', GUARD];
			if (catalog.some(name => !system.includes(name)))
				throw new RecoveryTestError('database-cleanup', 'database-cleanup-failed');
		} finally {
			await connection.close();
		}
	}
}
