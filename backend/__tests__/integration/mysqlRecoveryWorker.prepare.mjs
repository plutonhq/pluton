// Disposable fixture only: generated credentials and TLS keys never leave its volumes.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const password = crypto.randomBytes(32).toString('hex');
const host = 'mysql-recovery.example.internal';
await fs.mkdir('/control', { recursive: true });
await fs.mkdir('/config', { recursive: true });
for (const prefix of ['ca', 'wrong-ca']) {
	const result = spawnSync(
		'/usr/bin/openssl',
		[
			'req',
			'-x509',
			'-newkey',
			'rsa:2048',
			'-nodes',
			'-days',
			'1',
			'-subj',
			`/CN=${prefix}-fixture`,
			'-keyout',
			`/control/${prefix}.key`,
			'-out',
			`/control/${prefix}.pem`,
		],
		{ stdio: 'ignore' }
	);
	if (result.status !== 0) throw new Error('Synthetic CA generation failed.');
}
for (const args of [
	[
		'req',
		'-newkey',
		'rsa:2048',
		'-nodes',
		'-subj',
		`/CN=${host}`,
		'-keyout',
		'/control/server.key',
		'-out',
		'/control/server.csr',
	],
	[
		'x509',
		'-req',
		'-in',
		'/control/server.csr',
		'-CA',
		'/control/ca.pem',
		'-CAkey',
		'/control/ca.key',
		'-CAcreateserial',
		'-days',
		'1',
		'-extfile',
		'/control/extensions',
		'-out',
		'/control/server.pem',
	],
]) {
	await fs.writeFile(
		'/control/extensions',
		`subjectAltName=DNS:${host}\nextendedKeyUsage=serverAuth\n`
	);
	if (spawnSync('/usr/bin/openssl', args, { stdio: 'ignore' }).status !== 0)
		throw new Error('Synthetic server certificate generation failed.');
}
await fs.chown('/control/server.key', 999, 999);
await fs.chmod('/control/server.key', 0o600);
await fs.writeFile(
	'/control/targets.json',
	JSON.stringify({
		engine: 'mysql',
		host,
		port: 3306,
		username: 'recovery_user',
		password,
		tls: 'verify-identity',
		enabled: true,
		dedicated: true,
	}),
	{ mode: 0o640 }
);
await fs.chown('/control/targets.json', 0, 10001);
await fs.writeFile(
	'/control/provision.sql',
	`CREATE DATABASE pluton_recovery_guard;
CREATE TABLE pluton_recovery_guard.pluton_recovery_guard(purpose VARCHAR(80));
INSERT INTO pluton_recovery_guard.pluton_recovery_guard VALUES('pluton-phase6-recovery-only');
CREATE USER 'recovery_user'@'%' IDENTIFIED BY '${password}' REQUIRE SSL;
GRANT SELECT ON pluton_recovery_guard.pluton_recovery_guard TO 'recovery_user'@'%';
GRANT ALL PRIVILEGES ON \`example\\_db\`.* TO 'recovery_user'@'%';
`,
	{ mode: 0o400 }
);
await fs.chown('/control/provision.sql', 999, 999);
await fs.writeFile(
	'/config/target.json',
	JSON.stringify({
		host,
		port: 3306,
		username: 'recovery_user',
		databases: ['example_db'],
		maxArtifactBytes: 1024 * 1024,
	}),
	{ mode: 0o644 }
);
await fs.copyFile('/control/ca.pem', '/config/ca.pem');
await fs.chmod('/config/ca.pem', 0o644);
console.log('Synthetic target, CA, and private credential fixture prepared.');
