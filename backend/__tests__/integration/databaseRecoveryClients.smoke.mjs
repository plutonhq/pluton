// Runs the actual compiled Phase 6 importer in the FINAL production image as pluton 10001.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RecoveryDatabaseImporter } from '/app/backend/dist/utils/recoveryDatabaseImport.js';
import { detectRecoveryClient } from '/app/backend/dist/utils/recoveryDatabaseClients.js';
import { runRecoveryProcess } from '/app/backend/dist/utils/recoveryProcess.js';

assert.equal(process.getuid(), 10001);
assert.equal(process.getgid(), 10001);
const targets = JSON.parse(await fs.readFile('/fixture-control/targets.json', 'utf8'));
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'production-client-import-'));
const secrets = targets.map(target => target.password);
const stages = [];
const leases = [];
const store = {
	addLease: async lease => leases.push(lease),
	removeLease: async id =>
		leases.splice(
			leases.findIndex(lease => lease.id === id),
			1
		),
	leases: async () => leases,
	leaseTarget: async id => targets.find(target => target.engine === id),
};
let invocations = 0;
const checkedRun = async input => {
	invocations++;
	assert(!input.args.includes('--password'));
	for (const secret of secrets) assert(!JSON.stringify(input.args).includes(secret));
	for (const key of ['SECRET', 'ENCRYPTION_KEY', 'MYSQL_PWD', 'PGPASSWORD'])
		assert(!(key in input.env));
	const credentials = input.env.PGPASSFILE || input.args[0].split('=')[1];
	const stat = await fs.stat(credentials);
	assert.equal(stat.uid, 10001);
	assert.equal(stat.mode & 0o777, 0o600);
	assert.equal((await fs.stat(input.cwd)).mode & 0o777, 0o700);
	const result = await runRecoveryProcess(input);
	if (typeof input.input === 'string' && input.input.includes('information_schema.tables')) {
		const row = await runRecoveryProcess({
			...input,
			input: 'SELECT value FROM fixture_entries;',
			capture: true,
		});
		assert.equal(row.trim(), 'synthetic recovery client content');
	}
	return result;
};
const importer = new RecoveryDatabaseImporter(store, checkedRun);
const controller = new AbortController();
try {
	for (const target of targets) {
		const file = path.join(root, `${target.engine}.sql`);
		const sql =
			"CREATE TABLE fixture_entries(value VARCHAR(100)); INSERT INTO fixture_entries VALUES ('synthetic recovery client content');\n";
		await fs.writeFile(file, sql, { mode: 0o600 });
		const entry = {
			databaseId: 'db_app',
			engine: target.engine,
			database: 'example_db',
			path: '/pluton/database/app.sql',
			bytes: Buffer.byteLength(sql),
			sha256: crypto.createHash('sha256').update(sql).digest('hex'),
			artifactValidation: 'passed',
			importValidation: 'pending',
		};
		const input = {
			testId: 'a'.repeat(24),
			targetId: target.engine,
			target,
			entry,
			file,
			directory: root,
			signal: controller.signal,
			allowedDatabases: ['example_db'],
			stage: stage => stages.push(stage),
		};
		await importer.importDatabase(input);
		assert.equal(entry.importValidation, 'passed');
		assert.equal(entry.tables, 1);
		assert.equal(entry.views, 0);
		assert.equal(leases.length, 1);
		await importer.cleanup(leases[0], root);
		assert.equal(leases.length, 0);
		assert.deepEqual(
			await fs.readdir(root),
			targets
				.slice(0, targets.indexOf(target) + 1)
				.map(value => `${value.engine}.sql`)
				.sort()
		);
		console.log(
			`PASS final-image ${target.engine} import/catalog/content/owned cleanup as UID 10001; private credentials, no secret argv/environment.`
		);
		if (target.engine === 'postgresql') {
			const escaped = path.join(root, 'must-not-exist');
			const malicious = `\\unrestrict \`touch ${escaped}\`\nSELECT 1;\n`;
			await fs.writeFile(file, malicious, { mode: 0o600 });
			await assert.rejects(
				importer.importDatabase({
					...input,
					entry: {
						...entry,
						bytes: Buffer.byteLength(malicious),
						sha256: crypto.createHash('sha256').update(malicious).digest('hex'),
						importValidation: 'pending',
					},
				}),
				error => error.code === 'database-import-failed'
			);
			await assert.rejects(fs.stat(escaped), error => error.code === 'ENOENT');
			for (const lease of [...leases]) await importer.cleanup(lease, root);
			console.log(
				'PASS patched psql rejects archived unrestrict input expansion; no shell/file escape.'
			);
		}
	}
	const before = invocations;
	assert.throws(
		() => detectRecoveryClient('mysql'),
		error => ['database-client-incompatible', 'database-client-missing'].includes(error.code)
	);
	const target = { ...targets[0], engine: 'mysql' };
	await assert.rejects(
		importer.importDatabase({
			testId: 'b'.repeat(24),
			targetId: 'mysql',
			target,
			entry: { engine: 'mysql', database: 'example_db' },
			file: path.join(root, 'mariadb.sql'),
			directory: root,
			signal: controller.signal,
			allowedDatabases: ['example_db'],
			stage: stage => stages.push(stage),
		}),
		error => ['database-client-incompatible', 'database-client-missing'].includes(error.code)
	);
	assert.equal(
		invocations,
		before,
		'A MariaDB alias must fail before connecting or preparing credentials.'
	);
	assert.equal(leases.length, 0);
	for (const secret of secrets) assert(!JSON.stringify(stages).includes(secret));
	console.log(
		'PASS final-image MySQL alias refused before any import; genuine MySQL integration NOT VALIDATED.'
	);
	for (const pid of (await fs.readdir('/proc')).filter(value => /^\d+$/.test(value))) {
		const name = await fs.readFile(`/proc/${pid}/comm`, 'utf8').catch(() => '');
		assert(
			!['mariadbd', 'mysqld', 'postgres'].includes(name.trim()),
			'No DB servers may run in the application container.'
		);
	}
	console.log(
		'PASS database servers run only in the separate disposable fixture, not the application image.'
	);
} finally {
	await fs.rm(root, { recursive: true, force: true });
}
