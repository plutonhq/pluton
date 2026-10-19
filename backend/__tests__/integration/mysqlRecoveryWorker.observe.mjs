// Run inside the isolated WORKER while a native client is executing.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Anchored options only: --protocol / --get-server-public-key are not -p passwords.
export const isPasswordArgument = arg => /^(?:--password[123]?(?:=|$)|-p(?:[^-]|$))/.test(arg);
async function observe() {
	const active = (await fs.readdir('/tmp')).filter(name => name.startsWith('pluton-mysql-'));
	assert.equal(active.length, 1);
	const secrets = [];
	for (const directory of active) {
		assert.equal((await fs.stat(`/tmp/${directory}`)).mode & 0o777, 0o700);
		for (const file of await fs.readdir(`/tmp/${directory}`)) {
			const candidate = `/tmp/${directory}/${file}`;
			const stat = await fs.stat(candidate);
			assert.equal(stat.uid, 10001);
			assert.equal(stat.mode & 0o777, stat.isDirectory() ? 0o700 : 0o600);
			if (file.startsWith('credentials-')) {
				const content = await fs.readFile(candidate, 'utf8');
				assert(content.includes('ssl-mode=VERIFY_IDENTITY\n'));
				// This fixture generates hex credentials; never print the credential or CNF.
				const password = /^password="([a-f0-9]{64})"$/m.exec(content)?.[1];
				assert(!!password);
				secrets.push(password);
			}
		}
	}
	assert.equal(secrets.length, 1);
	let clients = 0;
	for (let sample = 0; sample < 30; sample++) {
		for (const pid of (await fs.readdir('/proc')).filter(value => /^\d+$/.test(value))) {
			try {
				const argv = (await fs.readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0');
				if (argv[0] !== '/usr/bin/mysql') continue;
				clients++;
				assert(argv[1].startsWith('--defaults-file=/tmp/pluton-mysql-'));
				const suspicious = argv.filter(isPasswordArgument);
				if (suspicious.length)
					process.stderr.write(
						JSON.stringify({
							rejectedArgumentCategories: suspicious.map(
								arg => /^--([a-z-]+)(?:=|$)/.exec(arg)?.[1] || 'short-password-option'
							),
						}) + '\n'
					);
				assert(!suspicious.length);
				const env = await fs.readFile(`/proc/${pid}/environ`, 'utf8');
				assert(!/(?:MYSQL_PWD|PASSWORD|SECRET|ENCRYPTION_KEY)=/.test(env));
				for (const secret of secrets) {
					assert(!argv.join('\0').includes(secret));
					assert(!env.includes(secret));
				}
				assert(argv.includes('--binary-mode'));
				assert(argv.includes('--local-infile=0'));
				assert(argv.includes('--commands=OFF'));
			} catch (error) {
				if (error.code !== 'ENOENT') throw error;
			}
		}
		await new Promise(resolve => setTimeout(resolve, 10));
	}
	assert(clients > 0);
	console.log(
		'PASS repeated worker inspection: private SQL/credentials 0600, UID 10001, verified TLS, no password argv or environment.'
	);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await observe();
