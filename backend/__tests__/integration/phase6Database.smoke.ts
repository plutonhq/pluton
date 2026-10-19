/** Phase 6 extension of the existing opt-in disposable Linux backup fixture.
 * No production access, source database servers are stopped before this runs. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { plans } from '../../src/db/schema/plans';
import { backups } from '../../src/db/schema/backups';
import {
	recoveryTests,
	recoveryTargets,
	recoveryTestPolicies,
	recoveryImportLeases,
} from '../../src/db/schema/recoveryTests';
import { RecoveryTestStore } from '../../src/stores/RecoveryTestStore';
import { RecoveryTestService } from '../../src/services/RecoveryTestService';
import { RecoveryDatabaseImporter } from '../../src/utils/recoveryDatabaseImport';
import { runRecoveryProcess } from '../../src/utils/recoveryProcess';
import { detectRecoveryClient } from '../../src/utils/recoveryDatabaseClients';
import { processManager } from '../../src/managers/ProcessManager';
import type { DatabaseType } from '../../src/db';
import type { RemoteRepositoryRecoveryService } from '../../src/services/RemoteRepositoryRecoveryService';

export async function verifyPhase6Recovery(fixture: {
	mode: string;
	scratch: string;
	plan: any;
	backup: any;
	repository: any;
	recovery: RemoteRepositoryRecoveryService;
	secret: string;
	children: ReturnType<typeof spawn>[];
	execute: (binary: string, args: string[], input?: string) => Promise<string>;
	port: () => Promise<number>;
	waitPort: (port: number) => Promise<void>;
	sftpRoot: string;
}) {
	const {
		mode,
		scratch,
		plan,
		backup,
		repository,
		recovery,
		secret,
		children,
		execute,
		port,
		waitPort,
		sftpRoot,
	} = fixture;
	assert.notEqual(process.getuid?.(), 0);
	const needsMaria = ['phase6-mariadb', 'phase6-mixed', 'phase6-mixed-failure'].includes(mode);
	const needsPg = ['phase6-postgresql', 'phase6-mixed', 'phase6-mixed-failure'].includes(mode);
	const targetPassword = crypto.randomBytes(24).toString('base64url'); // separate from every backup account
	const marker =
		"CREATE TABLE pluton_recovery_guard (purpose VARCHAR(64) NOT NULL); INSERT INTO pluton_recovery_guard VALUES ('pluton-phase6-recovery-only');";
	let mariaPort = 0,
		pgPort = 0;
	if (needsMaria) {
		const directory = path.join(scratch, 'recovery-maria'),
			socket = path.join(scratch, 'recovery-maria.sock');
		await execute('/usr/bin/mariadb-install-db', [
			'--no-defaults',
			`--datadir=${directory}`,
			'--auth-root-authentication-method=normal',
			'--skip-test-db',
			`--tmpdir=${scratch}`,
		]);
		mariaPort = await port();
		children.push(
			spawn(
				'/usr/bin/mariadbd',
				[
					'--no-defaults',
					`--datadir=${directory}`,
					`--socket=${socket}`,
					`--port=${mariaPort}`,
					'--bind-address=127.0.0.1',
					`--pid-file=${path.join(scratch, 'recovery-maria.pid')}`,
					`--log-error=${path.join(scratch, 'recovery-maria.log')}`,
					'--skip-log-bin',
					'--skip-name-resolve',
					'--innodb-buffer-pool-size=64M',
					`--tmpdir=${scratch}`,
				],
				{ stdio: 'ignore' }
			)
		);
		await waitPort(mariaPort);
		await execute(
			'/usr/bin/mariadb',
			['--no-defaults', `--socket=${socket}`, '-u', 'root'],
			`CREATE DATABASE pluton_recovery_guard; USE pluton_recovery_guard; ${marker}
CREATE USER 'recovery_user'@'127.0.0.1' IDENTIFIED BY '${targetPassword}';
GRANT SELECT ON pluton_recovery_guard.pluton_recovery_guard TO 'recovery_user'@'127.0.0.1';
GRANT ALL PRIVILEGES ON \`example\\_db\`.* TO 'recovery_user'@'127.0.0.1';`
		);
	}
	if (needsPg) {
		const directory = path.join(scratch, 'recovery-pg'),
			sockets = path.join(scratch, 'recovery-pg-sockets');
		await fs.mkdir(sockets, { mode: 0o700 });
		await execute('/usr/bin/initdb', [
			'--pgdata',
			directory,
			'--username',
			'fixture_admin',
			'--auth-local',
			'trust',
			'--auth-host',
			'scram-sha-256',
			'--no-locale',
			'--encoding',
			'UTF8',
			'--no-sync',
		]);
		pgPort = await port();
		children.push(
			spawn(
				'/usr/bin/postgres',
				[
					'-D',
					directory,
					'-h',
					'127.0.0.1',
					'-p',
					String(pgPort),
					'-k',
					sockets,
					'-c',
					'shared_buffers=16MB',
					'-c',
					'fsync=off',
					'-c',
					'synchronous_commit=off',
				],
				{ stdio: 'ignore' }
			)
		);
		await waitPort(pgPort);
		const admin = [
			'-X',
			'--no-password',
			'-h',
			sockets,
			'-p',
			String(pgPort),
			'-U',
			'fixture_admin',
			'-v',
			'ON_ERROR_STOP=1',
		];
		// pg_dump preserves ACL grantee names too. Provision the fixture's archived
		// grantee as a NOLOGIN role, without copying any backup credential.
		await execute(
			'/usr/bin/psql',
			[...admin, '-d', 'postgres'],
			`CREATE ROLE app_owner LOGIN CREATEDB NOSUPERUSER NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${targetPassword}'; CREATE ROLE backup_pg NOLOGIN NOSUPERUSER NOCREATEROLE NOREPLICATION NOBYPASSRLS; CREATE DATABASE pluton_recovery_guard;`
		);
		await execute(
			'/usr/bin/psql',
			[...admin, '-d', 'pluton_recovery_guard'],
			`${marker} GRANT CONNECT ON DATABASE pluton_recovery_guard TO app_owner; GRANT USAGE ON SCHEMA public TO app_owner; GRANT SELECT ON pluton_recovery_guard TO app_owner;`
		);
	}
	const sqlite = new Database(':memory:');
	const db = drizzle(sqlite, {
		schema: {
			plans,
			backups,
			recoveryTests,
			recoveryTargets,
			recoveryTestPolicies,
			recoveryImportLeases,
		},
	}) as unknown as DatabaseType;
	const store = new RecoveryTestStore(db, secret);
	const root = path.join(scratch, 'recovery-tests');
	const service = new RecoveryTestService(
		store,
		{ getById: async () => plan } as any,
		{ getById: async () => backup } as any,
		recovery,
		root
	);
	const repoManifest = async () => {
		const records: string[] = [];
		async function walk(directory: string) {
			for (const name of (await fs.readdir(directory)).sort()) {
				const file = path.join(directory, name);
				const stat = await fs.lstat(file);
				if (stat.isDirectory()) await walk(file);
				else
					records.push(
						`${path.relative(sftpRoot, file)}:${crypto
							.createHash('sha256')
							.update(await fs.readFile(file))
							.digest('hex')}`
					);
			}
		}
		await walk(sftpRoot);
		return records;
	};
	try {
		migrate(db, { migrationsFolder: '/app/backend/drizzle' });
		sqlite.exec(
			"INSERT INTO storages(id,name,type) VALUES ('sftp-01','Fixture SFTP','sftp'); INSERT INTO devices(id,name) VALUES ('agent-device-01','Fixture device'); INSERT INTO agent_identities(agent_id,device_id,encrypted_secret,hostname,os,architecture,agent_version,capabilities) VALUES ('agent-01','agent-device-01','synthetic-cipher','app-01','Linux','x86_64','0.4.0','{}');"
		);
		db.insert(plans)
			.values({ ...plan, title: 'Disposable application' })
			.run();
		sqlite
			.prepare(
				'INSERT INTO remote_managed_repositories(id,plan_id,agent_id,storage_id,storage_path,encrypted_password,initialized_at) VALUES (?,?,?,?,?,?,?)'
			)
			.run(
				repository.id,
				plan.id,
				repository.agentId,
				plan.storageId,
				plan.storagePath,
				repository.encryptedPassword,
				1
			);
		await store.savePolicy(plan.id, { enabled: true, databaseImport: 'required' });
		// Persist completion after opt-in, then let the ordinary durable reconciliation
		// discover it. No recovery dispatch from the source agent is involved.
		db.insert(backups)
			.values({ ...backup, ended: new Date(Date.now() + 1000), sourceConfig: plan.sourceConfig })
			.run();
		if (needsMaria)
			await store.saveTarget(plan.id, {
				engine: 'mariadb',
				host: '127.0.0.1',
				port: mariaPort,
				username: 'recovery_user',
				password: targetPassword,
				tls: 'local',
				enabled: true,
				dedicated: true,
			});
		if (needsPg)
			await store.saveTarget(plan.id, {
				engine: 'postgresql',
				host: '127.0.0.1',
				port: pgPort,
				username: 'app_owner',
				password:
					mode === 'phase6-mixed-failure' ? 'synthetic-wrong-recovery-password' : targetPassword,
				tls: 'local',
				enabled: true,
				dedicated: true,
			});
		const manifest = await repoManifest();
		await service.tick();
		await service.idle();
		const [row] = await store.list(plan.id);
		assert.ok(row);
		assert.equal(row.trigger, 'after_backup');
		assert.equal(row.snapshotId, backup.completionStats.snapshot_id);
		assert.equal(
			row.status,
			mode === 'phase6-mixed-failure' ? 'failed' : 'passed',
			`Recovery status: ${row.status}/${row.failureStage}/${row.failureCode}`
		);
		assert.ok(row.result?.filesystem?.files);
		assert.equal(row.result!.filesystem!.integrity, 'restic-restore-and-structure');
		assert.equal(
			row.result!.databases.length,
			needsMaria && needsPg ? 2 : needsMaria || needsPg ? 1 : 0
		);
		for (const entry of row.result!.databases) {
			assert.equal(entry.artifactValidation, 'passed');
			if (mode === 'phase6-mixed-failure' && entry.engine === 'postgresql') {
				assert.equal(entry.importValidation, 'failed');
				assert.equal(entry.failureCode, 'database-authentication-failed');
			} else {
				assert.equal(entry.importValidation, 'passed');
				assert.equal(entry.tables, 1);
				assert.equal(entry.views, 0);
			}
		}
		assert.deepEqual(row.result!.cleanup, { workspace: true, databases: true });
		assert.deepEqual(await store.leases(), []);
		assert.deepEqual(await fs.readdir(root), []);
		assert.deepEqual(await repoManifest(), manifest);
		assert.equal(db.select().from(backups).get()!.status, 'completed');
		assert.equal(backup.status, 'completed');
		await service.tick();
		await service.idle();
		assert.equal((await store.list(plan.id)).length, 1); // replay idempotency
		assert.ok(!JSON.stringify(row).includes(targetPassword));
		if (needsPg) {
			// Native \restrict rejects psql shell/file meta-commands even with an
			// otherwise valid SQL artifact. No helper file can be created outside staging.
			const importer = new RecoveryDatabaseImporter(store);
			const database = {
				...row.result!.databases.find(entry => entry.engine === 'postgresql')!,
				importValidation: 'pending' as const,
			};
			const target = {
				engine: 'postgresql' as const,
				host: '127.0.0.1',
				port: pgPort,
				username: 'app_owner',
				password: targetPassword,
				tls: 'local' as const,
				enabled: true,
				dedicated: true as const,
			};
			const file = path.join(scratch, 'unsafe-meta.sql'),
				escaped = path.join(scratch, 'must-not-exist');
			await fs.writeFile(file, `\\! touch ${escaped}\nSELECT 1;\n`, { mode: 0o600 });
			const targetRow = await store.target(plan.id, 'postgresql');
			assert.ok(targetRow);
			await assert.rejects(
				importer.importDatabase({
					testId: row.id,
					targetId: targetRow.id,
					target,
					entry: database,
					file,
					directory: scratch,
					signal: new AbortController().signal,
					allowedDatabases: [],
					stage: () => {},
				}),
				error => (error as any).code === 'database-import-failed'
			);
			for (const lease of await store.leases(row.id)) {
				// Failure-mode fixture used a wrong saved password: cleanup still must
				// use the correct isolated connection for this independent security probe.
				const cleanup = new RecoveryDatabaseImporter({
					...store,
					leaseTarget: async () => target,
					removeLease: store.removeLease.bind(store),
					leases: store.leases.bind(store),
					addLease: store.addLease.bind(store),
				} as any);
				await cleanup.cleanup(lease, scratch);
			}
			await assert.rejects(fs.lstat(escaped));
			assert.deepEqual(await store.leases(), []);
		}
		// Non-root real cancellation/timeout/forced-shutdown process groups: a long-running child
		// cannot outlive its rejected operation, including inherited stdout pipes.
		for (const action of ['timeout', 'cancel', 'forced-shutdown']) {
			const controller = new AbortController();
			const pidFile = path.join(scratch, `child-${action}.pid`);
			const program = `const {spawn}=require('child_process');const fs=require('fs');process.on('SIGTERM',()=>{});const c=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'inherit'});fs.writeFileSync(process.argv[1],String(c.pid));setInterval(()=>{},1000)`;
			const pending = runRecoveryProcess({
				binary: process.execPath,
				args: ['-e', program, pidFile],
				env: { PATH: '/usr/bin:/bin' },
				cwd: scratch,
				signal: controller.signal,
				stage: 'database-import',
				timeoutMs: 2000,
			});
			const observed = pending.catch(error => error);
			for (let i = 0; i < 200; i++) {
				try {
					await fs.stat(pidFile);
					break;
				} catch {
					await new Promise(resolve => setTimeout(resolve, 10));
				}
			}
			const pid = Number(await fs.readFile(pidFile, 'utf8'));
			if (action === 'cancel') controller.abort();
			if (action === 'forced-shutdown') processManager.killAll('SIGKILL');
			assert.equal(
				(await observed).code,
				action === 'cancel'
					? 'cancelled'
					: action === 'timeout'
						? 'database-import-timeout'
						: 'database-import-failed'
			);
			// A zombie is already dead; it may await fixture init reaping.
			try {
				const state = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
				assert.equal(state.split(' ')[2], 'Z');
			} catch (error) {
				assert.equal((error as any).code, 'ENOENT');
			}
		}
		console.log(
			JSON.stringify({
				phase: 6,
				mode,
				status: row.status,
				snapshotId: row.snapshotId,
				result: row.result,
				clients: [
					...(needsMaria ? [detectRecoveryClient('mariadb')] : []),
					...(needsPg ? [detectRecoveryClient('postgresql')] : []),
				],
				sourceDatabasesStopped: true,
				repositoryUnchanged: true,
				nonRoot: true,
				replayIdempotent: true,
			})
		);
	} finally {
		await service.shutdown();
		sqlite.close();
	}
}
