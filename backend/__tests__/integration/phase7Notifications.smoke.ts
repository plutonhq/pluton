/** Disposable receivers only. Run through scripts/validate-phase7.ps1, never a live app. */
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import tls from 'node:tls';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, chmod, readFile, rm, copyFile } from 'node:fs/promises';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';
import { notificationFixture, fixtureSecret } from '../fixtures/notifications';
import { NotificationDeliveryStore } from '../../src/stores/NotificationDeliveryStore';
import { NotificationDeliveryManager } from '../../src/notifications/NotificationDeliveryManager';
import { deliverNotification, webhookSignature } from '../../src/notifications/outboundDelivery';
import {
	notificationEvents,
	type ChannelInput,
	type NotificationPayload,
} from '../../src/types/notificationDelivery';
const master = 'synthetic-master-key-for-disposable-tests';
const exec = promisify(execFile);
function decodedMessage(value: string) {
	const body = value.slice(value.indexOf('\n\n') + 2);
	return /Content-Transfer-Encoding: base64/i.test(value)
		? Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf8')
		: body
				.replace(/=\n/g, '')
				.replace(/=([0-9a-f]{2})/gi, (_match, hex) => String.fromCharCode(parseInt(hex, 16)));
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(test: () => boolean) {
	for (let n = 0; n < 150; n++) {
		if (test()) return;
		await sleep(50);
	}
	throw new Error('Disposable notification fixture deadline exceeded.');
}

if (process.argv[2] === 'restart') {
	const sqlite = new Database(process.env.PHASE7_FIXTURE_DB!);
	let now = Number(process.env.PHASE7_FIXTURE_TIME);
	const store = new NotificationDeliveryStore(sqlite, master, () => now);
	const manager = new NotificationDeliveryManager(store);
	manager.start();
	now += 30000;
	manager.tick();
	await until(() => store.deliveries()[0]?.status === 'succeeded');
	await manager.shutdown();
	sqlite.close();
	console.log('phase7 worker process restart: passed');
} else {
	const address = Object.values(os.networkInterfaces())
		.flat()
		.find(
			item =>
				item?.family === 'IPv4' &&
				!item.internal &&
				/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(item.address)
		)?.address;
	assert.ok(
		address,
		'The integration fixture requires a disposable private Docker --internal network.'
	);
	const approved = { network: 'trusted-lan' as const, allowedCidrs: [`${address}/32`] };
	const root =
		process.env.PHASE7_FIXTURE_CERTDIR || (await mkdtemp(path.join(os.tmpdir(), 'pluton-phase7-')));
	const ownsRoot = !process.env.PHASE7_FIXTURE_CERTDIR;
	let webhookStatus = 204,
		webhookDelay = 0;
	const requests: { body: string; headers: http.IncomingHttpHeaders }[] = [];
	const webhook = http.createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on('data', chunk => chunks.push(chunk));
		req.on('end', () => {
			requests.push({ body: Buffer.concat(chunks).toString(), headers: req.headers });
			const send = () => {
				res.statusCode = webhookStatus;
				if (webhookStatus === 429) res.setHeader('Retry-After', '1');
				if (webhookStatus === 302) res.setHeader('Location', 'http://127.0.0.1/private');
				res.end(fixtureSecret);
			};
			if (webhookDelay) setTimeout(send, webhookDelay).unref();
			else send();
		});
	});
	const sockets = new Set<net.Socket>();
	let authCount = 0,
		authRequired = false,
		rejectMail = false;
	const messages: string[] = [];
	let context: tls.SecureContext | undefined;
	if (process.env.PHASE7_FIXTURE_CERTDIR)
		context = tls.createSecureContext({
			key: await readFile(path.join(root, 'key.pem')),
			cert: await readFile(path.join(root, 'cert.pem')),
		});
	function session(socket: net.Socket, secure = false, greeting = true) {
		sockets.add(socket);
		socket.once('close', () => sockets.delete(socket));
		socket.on('error', () => {});
		let buffer = '',
			data = false,
			body = '',
			authorized = !authRequired;
		if (greeting) socket.write('220 fixture ESMTP\r\n');
		const onData = (chunk: Buffer) => {
			buffer += chunk.toString();
			let newline: number;
			while ((newline = buffer.indexOf('\r\n')) >= 0) {
				const line = buffer.slice(0, newline);
				buffer = buffer.slice(newline + 2);
				if (data) {
					if (line === '.') {
						data = false;
						messages.push(body);
						body = '';
						socket.write('250 accepted\r\n');
					} else body += line + '\n';
					continue;
				}
				if (/^EHLO|^HELO/.test(line)) {
					socket.write(
						`250-fixture\r\n${context && !secure ? '250-STARTTLS\r\n' : ''}250 AUTH PLAIN\r\n`
					);
				} else if (/^AUTH PLAIN /.test(line)) {
					authCount++;
					const parts = Buffer.from(line.slice(11), 'base64').toString().split('\0');
					authorized = parts[1] === 'notification-user' && parts[2] === fixtureSecret;
					socket.write(authorized ? '235 authenticated\r\n' : '535 authentication failed\r\n');
				} else if (line === 'STARTTLS' && context && !secure) {
					socket.write('220 start TLS\r\n');
					socket.removeListener('data', onData);
					const upgraded = new tls.TLSSocket(socket, { isServer: true, secureContext: context });
					session(upgraded, true, false);
					return;
				} else if (/^MAIL FROM:|^RCPT TO:/.test(line))
					socket.write(
						rejectMail
							? '550 rejected\r\n'
							: authorized
								? '250 okay\r\n'
								: '530 authentication required\r\n'
					);
				else if (line === 'DATA') {
					socket.write('354 send data\r\n');
					data = true;
				} else if (line === 'QUIT') {
					socket.end('221 bye\r\n');
				} else if (line === 'RSET' || line === 'NOOP') socket.write('250 okay\r\n');
				else socket.write('500 unsupported\r\n');
			}
		};
		socket.on('data', onData);
	}
	const smtp = net.createServer(socket => session(socket));
	const implicit = context
		? tls.createServer(
				{
					key: await readFile(path.join(root, 'key.pem')),
					cert: await readFile(path.join(root, 'cert.pem')),
				},
				socket => session(socket, true)
			)
		: undefined;
	const fixture = notificationFixture();
	try {
		for (const server of [webhook, smtp, ...(implicit ? [implicit] : [])])
			await new Promise<void>(resolve => server.listen(0, address, resolve));
		const port = (server: net.Server) => (server.address() as net.AddressInfo).port;
		const webhookInput: ChannelInput = {
			...fixture.channel(),
			config: { url: `http://${address}:${port(webhook)}/events`, timeoutMs: 1000, ...approved },
		} as ChannelInput;
		const smtpInput: ChannelInput = {
			...fixture.channel('smtp'),
			config: {
				...(fixture.channel('smtp') as any).config,
				host: address!,
				port: port(smtp),
				security: 'plain',
				username: '',
				...approved,
			},
			secret: undefined,
		} as ChannelInput;
		const channel = fixture.store.saveChannel(webhookInput);
		const mail = fixture.store.saveChannel(smtpInput);
		const payload: NotificationPayload = {
			version: 1,
			event_id: 'event-fixture',
			event_type: 'notification.test',
			timestamp: new Date().toISOString(),
		};
		assert.equal((await deliverNotification(channel, payload, fixtureSecret)).success, true);
		const received = requests.at(-1)!;
		assert.equal(
			received.headers['x-pluton-signature'],
			webhookSignature(
				fixtureSecret,
				received.headers['x-pluton-timestamp'] as string,
				payload.event_id,
				received.body
			)
		);
		assert.ok(!received.body.includes(fixtureSecret));
		for (const status of [429, 503, 401, 302]) {
			webhookStatus = status;
			const result = await deliverNotification(channel, payload, fixtureSecret);
			assert.equal(result.retryable, [429, 503].includes(status));
			assert.equal(result.status, status);
			if (status === 302) assert.equal(result.code, 'redirect-refused');
		}
		webhookStatus = 204;
		webhookDelay = 1200;
		assert.equal((await deliverNotification(channel, payload)).code, 'delivery-timeout');
		webhookDelay = 0;
		assert.equal((await deliverNotification(mail, payload)).success, true);
		assert.equal(authCount, 0);
		authRequired = true;
		const authenticated = fixture.store.saveChannel({
			...smtpInput,
			config: { ...smtpInput.config, username: 'notification-user' },
			secret: fixtureSecret,
		} as ChannelInput);
		assert.equal((await deliverNotification(authenticated, payload, fixtureSecret)).success, true);
		assert.ok(authCount > 0);
		assert.equal(
			(await deliverNotification(authenticated, payload, 'synthetic-wrong-password')).code,
			'smtp-auth-failed'
		);
		rejectMail = true;
		assert.equal(
			(await deliverNotification(authenticated, payload, fixtureSecret)).code,
			'smtp-rejected'
		);
		rejectMail = false;
		if (context) {
			const resolver = async () => [{ address: address!, family: 4 }];
			for (const security of ['starttls', 'tls'] as const) {
				const input = {
					...smtpInput,
					config: {
						...smtpInput.config,
						host: 'smtp.example.internal',
						port: security === 'tls' ? port(implicit!) : port(smtp),
						security,
						username: 'notification-user',
					},
					secret: fixtureSecret,
				} as ChannelInput;
				const c = fixture.store.saveChannel(input);
				const result = await deliverNotification(c, payload, fixtureSecret, { resolver });
				assert.equal(result.success, process.argv[2] !== 'tls-untrusted');
				if (process.argv[2] === 'tls-untrusted') assert.equal(result.code, 'tls-failed');
			}
			if (process.argv[2] !== 'tls-untrusted') {
				const mismatch = fixture.store.saveChannel({
					...smtpInput,
					config: {
						...smtpInput.config,
						host: 'wrong.example.internal',
						port: port(implicit!),
						security: 'tls',
						username: 'notification-user',
					},
					secret: fixtureSecret,
				} as ChannelInput);
				assert.equal(
					(await deliverNotification(mismatch, payload, fixtureSecret, { resolver })).code,
					'tls-failed'
				);
			}
		} else {
			const noTls = fixture.store.saveChannel({
				...smtpInput,
				config: { ...smtpInput.config, security: 'starttls' },
			} as ChannelInput);
			assert.equal((await deliverNotification(noTls, payload)).success, false);
		}
		authRequired = false;
		fixture.store.saveSubscription('plan-01', {
			enabled: true,
			channelIds: [channel.id, mail.id],
			events: [...notificationEvents],
		});
		fixture.backup('backup-disposable', 'completed');
		fixture.recovery('recovery-disposable', 'passed_with_warning', {
			databases: [
				{
					databaseId: 'db_example',
					engine: 'mariadb',
					bytes: 500,
					artifactValidation: 'passed',
					importValidation: 'disabled',
				},
			],
		});
		fixture.store.reconcile();
		fixture.store.reconcile();
		assert.equal(fixture.store.deliveries().length, 4);
		const manager = new NotificationDeliveryManager(fixture.store);
		manager.start();
		await until(() => fixture.store.deliveries().every(row => row.status === 'succeeded'));
		await manager.shutdown();
		assert.ok(messages.some(message => decodedMessage(message).includes('SQL import NOT TESTED')));
		assert.ok(messages.every(message => !decodedMessage(message).includes(fixtureSecret)));
		assert.equal(
			fixture.sqlite.prepare("SELECT status FROM backups WHERE id='backup-disposable'").get()!
				.status,
			'completed'
		);
		const restart = notificationFixture();
		const restartChannel = restart.store.saveChannel(webhookInput);
		restart.store.test(restartChannel.id);
		const lease = restart.store.claim('crashed-fixture-worker')!;
		const database = path.join(root, 'restart.db');
		await restart.sqlite.backup(database);
		await chmod(database, 0o600);
		const timestamp = restart.now() + 61000;
		restart.sqlite.close();
		const child = await exec(process.execPath, ['--import', 'tsx', process.argv[1], 'restart'], {
			env: { ...process.env, PHASE7_FIXTURE_DB: database, PHASE7_FIXTURE_TIME: String(timestamp) },
			timeout: 15000,
		});
		assert.match(child.stdout, /restart: passed/);
		const savedDb = new Database(database);
		assert.equal(
			(
				savedDb
					.prepare('SELECT status FROM notification_deliveries WHERE id=?')
					.get(lease.id) as any
			).status,
			'succeeded'
		);
		savedDb.close();
		if (ownsRoot) {
			if (process.env.PHASE7_FIXTURE_CA_SOURCE) {
				for (const name of ['key.pem', 'cert.pem'])
					await copyFile(
						path.join(process.env.PHASE7_FIXTURE_CA_SOURCE, name),
						path.join(root, name)
					);
			} else
				execFileSync(
					'openssl',
					[
						'req',
						'-x509',
						'-newkey',
						'rsa:2048',
						'-nodes',
						'-keyout',
						path.join(root, 'key.pem'),
						'-out',
						path.join(root, 'cert.pem'),
						'-days',
						'1',
						'-subj',
						'/CN=smtp.example.internal',
						'-addext',
						'subjectAltName=DNS:smtp.example.internal',
					],
					{ stdio: 'ignore' }
				);
			await chmod(path.join(root, 'key.pem'), 0o600);
			for (const mode of ['tls-trusted', 'tls-untrusted']) {
				const env = { ...process.env, PHASE7_FIXTURE_CERTDIR: root };
				if (mode === 'tls-trusted') env.NODE_EXTRA_CA_CERTS = path.join(root, 'cert.pem');
				else delete env.NODE_EXTRA_CA_CERTS;
				const child = await exec(process.execPath, ['--import', 'tsx', process.argv[1], mode], {
					env,
					timeout: 30000,
				});
				assert.match(child.stdout, /TLS .*: passed/);
			}
		}
		console.log(
			context
				? `phase7 isolated SMTP STARTTLS / implicit TLS ${process.argv[2] === 'tls-untrusted' ? 'untrusted certificate refused' : 'verified'}: passed`
				: 'phase7 isolated HTTP/HMAC/status/timeout + SMTP/auth/rejection + lifecycle/dedup + process restart + verified/untrusted TLS: passed'
		);
	} finally {
		fixture.sqlite.close();
		for (const socket of sockets) socket.destroy();
		for (const server of [webhook, smtp, ...(implicit ? [implicit] : [])]) {
			if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
		}
		if (ownsRoot) await rm(root, { recursive: true, force: true });
	}
}
