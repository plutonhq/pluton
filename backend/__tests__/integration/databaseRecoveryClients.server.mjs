// Disposable DB-only container. Credentials go only to a private ephemeral volume, never logs/argv.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'recovery-db-only-'));
const children = [];
let stage = 'mariadb-initialization';
async function run(binary, args, sql) {
	try {
		const pending = execute(binary, args, { timeout: 30_000, maxBuffer: 1024 ** 2 });
		pending.child.stdin?.end(sql);
		await pending;
	} catch {
		throw new Error('Disposable database fixture initialization failed.');
	}
}
async function wait(port) {
	for (let attempt = 0; attempt < 450; attempt++) {
		if (children.some(child => child.exitCode !== null))
			throw new Error('Disposable database process stopped before readiness.');
		if (
			await new Promise(resolve => {
				const socket = net.createConnection({ host: '127.0.0.1', port });
				socket.once('connect', () => {
					socket.destroy();
					resolve(true);
				});
				socket.once('error', () => resolve(false));
			})
		)
			return;
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	throw new Error('Disposable database listener unavailable.');
}
try {
	const maria = path.join(root, 'maria'),
		pg = path.join(root, 'pg'),
		socket = path.join(root, 'maria.sock');
	await run('/usr/bin/mariadb-install-db', [
		'--no-defaults',
		`--datadir=${maria}`,
		'--auth-root-authentication-method=normal',
		'--skip-test-db',
		`--tmpdir=${root}`,
	]);
	children.push(
		spawn(
			'/usr/bin/mariadbd',
			[
				'--no-defaults',
				`--datadir=${maria}`,
				`--socket=${socket}`,
				'--bind-address=127.0.0.1',
				'--port=3306',
				`--pid-file=${root}/maria.pid`,
				`--log-error=${root}/maria.log`,
				'--skip-log-bin',
				'--skip-name-resolve',
				'--innodb-buffer-pool-size=64M',
				`--tmpdir=${root}`,
			],
			{ stdio: 'ignore' }
		)
	);
	await wait(3306);
	stage = 'mariadb-marker-and-grants';
	const mariaPassword = crypto.randomBytes(32).toString('hex');
	const guard =
		"CREATE TABLE pluton_recovery_guard (purpose VARCHAR(64) NOT NULL); INSERT INTO pluton_recovery_guard VALUES ('pluton-phase6-recovery-only');";
	await run(
		'/usr/bin/mariadb',
		['--no-defaults', `--socket=${socket}`, '-u', 'root'],
		`CREATE DATABASE pluton_recovery_guard; USE pluton_recovery_guard; ${guard}
CREATE USER 'recovery_user'@'127.0.0.1' IDENTIFIED BY '${mariaPassword}';
GRANT SELECT ON pluton_recovery_guard.pluton_recovery_guard TO 'recovery_user'@'127.0.0.1';
GRANT ALL PRIVILEGES ON \`example\\_db\`.* TO 'recovery_user'@'127.0.0.1';`
	);
	const sockets = path.join(root, 'pg-sockets');
	stage = 'postgresql-initialization';
	await fs.mkdir(sockets, { mode: 0o700 });
	await run('/usr/bin/initdb', [
		'-D',
		pg,
		'-U',
		'fixture_admin',
		'--auth-local=trust',
		'--auth-host=scram-sha-256',
		'--no-locale',
		'--encoding=UTF8',
		'--no-sync',
	]);
	children.push(
		spawn(
			'/usr/bin/postgres',
			[
				'-D',
				pg,
				'-h',
				'127.0.0.1',
				'-p',
				'5432',
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
	await wait(5432);
	stage = 'postgresql-marker-and-grants';
	const pgPassword = crypto.randomBytes(32).toString('hex');
	const admin = [
		'-X',
		'--no-password',
		'-h',
		sockets,
		'-p',
		'5432',
		'-U',
		'fixture_admin',
		'-v',
		'ON_ERROR_STOP=1',
	];
	await run(
		'/usr/bin/psql',
		[...admin, '-d', 'postgres'],
		`CREATE ROLE app_owner LOGIN CREATEDB NOSUPERUSER NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${pgPassword}'; CREATE DATABASE pluton_recovery_guard;`
	);
	await run(
		'/usr/bin/psql',
		[...admin, '-d', 'pluton_recovery_guard'],
		`${guard} GRANT CONNECT ON DATABASE pluton_recovery_guard TO app_owner; GRANT USAGE ON SCHEMA public TO app_owner; GRANT SELECT ON pluton_recovery_guard TO app_owner;`
	);
	stage = 'private-control-file';
	await fs.writeFile(
		'/fixture-control/targets.json',
		JSON.stringify([
			{
				engine: 'mariadb',
				host: '127.0.0.1',
				port: 3306,
				username: 'recovery_user',
				password: mariaPassword,
				tls: 'local',
				dedicated: true,
				enabled: true,
			},
			{
				engine: 'postgresql',
				host: '127.0.0.1',
				port: 5432,
				username: 'app_owner',
				password: pgPassword,
				tls: 'local',
				dedicated: true,
				enabled: true,
			},
		]),
		{ mode: 0o640 }
	);
	await fs.writeFile('/fixture-control/ready', 'ready', { mode: 0o640 });
	console.log('Disposable recovery database fixture ready; credentials remain private.');
	await new Promise(resolve => {
		process.once('SIGTERM', resolve);
		process.once('SIGINT', resolve);
	});
} catch {
	// No SQL, native stderr, argument vectors or credential values are diagnostic output.
	console.error(
		JSON.stringify({ fixtureStage: stage, failure: 'disposable-fixture-initialization-failed' })
	);
	process.exitCode = 1;
} finally {
	for (const child of children) {
		child.kill('SIGTERM');
		if (child.exitCode === null) await new Promise(resolve => child.once('close', resolve));
	}
	await fs.rm(root, { recursive: true, force: true });
}
