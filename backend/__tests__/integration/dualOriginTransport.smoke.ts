import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import express from 'express';
import session from 'express-session';

if (process.env.PLUTON_DUAL_ORIGIN_FIXTURE !== '1')
	throw new Error('Disposable dual-origin fixture only.');
assert.equal(process.getuid?.(), 10001, 'Runtime web fixture must remain UID 10001.');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pluton-dual-origin-'));
const publicOrigin = 'https://pluton.example.internal',
	privateOrigin = 'http://192.0.2.10:5173';
const fixturePassword = crypto.randomBytes(24).toString('hex');
Object.assign(process.env, {
	NODE_ENV: 'test',
	PLUTON_DATA_DIR: root,
	USER_NAME: 'fixture-admin',
	USER_PASSWORD: fixturePassword,
	SECRET: crypto.randomBytes(32).toString('hex'),
	ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
	APP_URL: publicOrigin,
	APP_ALLOWED_ORIGINS: publicOrigin + ',' + privateOrigin,
});
const compiled = process.env.PLUTON_WEB_FIXTURE_COMPILED === '1';
const moduleFrom = (relative: string) =>
	import(
		new URL(
			'../../' + (compiled ? 'dist/' : 'src/') + relative + (compiled ? '.js' : '.ts'),
			import.meta.url
		).href
	);
const { parseWebOrigins } = await moduleFrom('utils/webOrigins');
const { webAccess, originAwareSession, sameOriginCors } = await moduleFrom('middlewares/webAccess');
const { UserController } = await moduleFrom('controllers/UserController');
const { createUserRouter } = await moduleFrom('routes/users');
const { createDatabaseRestoreRouter } = await moduleFrom('routes/databaseRestores');
const { createRecoveryTestRouter } = await moduleFrom('routes/recoveryTests');
const { RecoveryTestController } = await moduleFrom('controllers/RecoveryTestController');
const policy = parseWebOrigins(process.env);
const app = express(),
	store = new session.MemoryStore();
app.use(
	webAccess(policy),
	sameOriginCors(policy),
	originAwareSession(policy, {
		store,
		secret: process.env.SECRET!,
		resave: false,
		saveUninitialized: false,
		cookie: { maxAge: 900000 },
	})
);
app.use(express.json());
app.use('/api/user', createUserRouter(new UserController({} as any)));
let prepared = 0;
app.use(
	'/api/database-restores',
	createDatabaseRestoreRouter({
		preview: async () => {
			prepared++;
			return { verified: true };
		},
	} as any)
);
app.use(
	'/api/recovery-testing',
	createRecoveryTestRouter(
		new RecoveryTestController({
			preparation: async () => ({ verified: true }),
		} as any)
	)
);
const backend = http.createServer(app);
const cert = await fs.readFile('/fixture-certificates/cert.pem');
const proxy = https.createServer(
	{ cert, key: await fs.readFile('/fixture-certificates/key.pem') },
	(req, res) => {
		// The fixture is the fixed TLS terminator; it replaces, never appends, proxy headers.
		const upstream = http.request(
			{
				hostname: '127.0.0.1',
				port: (backend.address() as any).port,
				path: req.url,
				method: req.method,
				headers: {
					...req.headers,
					'host': 'pluton.example.internal',
					'x-forwarded-proto': 'https',
					'x-forwarded-host': 'pluton.example.internal',
					'x-forwarded-port': '443',
				},
			},
			incoming => {
				res.writeHead(incoming.statusCode!, incoming.headers);
				incoming.pipe(res);
			}
		);
		upstream.on('error', () => {
			res.statusCode = 502;
			res.end();
		});
		req.pipe(upstream);
	}
);
type Result = { status: number; headers: http.IncomingHttpHeaders; body: string };
async function call(
	origin: string,
	pathname: string,
	cookies: string[] = [],
	body: unknown = {},
	extra: Record<string, string> = {}
): Promise<Result> {
	const isPublic = origin === publicOrigin,
		port = (isPublic ? proxy : backend).address() as import('node:net').AddressInfo;
	const bytes = JSON.stringify(body);
	return new Promise((resolve, reject) => {
		const client = isPublic ? https : http;
		const req = client.request(
			{
				hostname: '127.0.0.1',
				port: port.port,
				path: pathname,
				method: 'POST',
				...(isPublic
					? { servername: 'pluton.example.internal', ca: cert, rejectUnauthorized: true }
					: {}),
				headers: {
					'Host': new URL(origin).host,
					'Origin': origin,
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(bytes),
					...(cookies.length ? { Cookie: cookies.join('; ') } : {}),
					...extra,
				},
			},
			res => {
				let data = '';
				res.on('data', chunk => {
					data += chunk;
					if (data.length > 65536) res.destroy();
				});
				res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: data }));
			}
		);
		req.setTimeout(5000, () => req.destroy(new Error('Fixture timeout')));
		req.on('error', reject);
		req.end(bytes);
	});
}
const authCookies = (value: Result) =>
	(value.headers['set-cookie'] || []).map(item => item.split(';')[0]);
try {
	await new Promise<void>(resolve => backend.listen(0, '127.0.0.1', resolve));
	await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
	for (const origin of [publicOrigin, privateOrigin]) {
		const login = await call(origin, '/api/user/login', [], {
			username: 'fixture-admin',
			password: fixturePassword,
		});
		assert.equal(login.status, 200);
		const values = login.headers['set-cookie']!;
		assert.equal(values.length, 2);
		for (const cookie of values) {
			assert(cookie.includes('HttpOnly'));
			assert(cookie.includes('SameSite=Lax'));
			assert(!cookie.includes('Domain='));
			assert.equal(/;\s*Secure(?:;|$)/.test(cookie), origin === publicOrigin);
		}
		for (const endpoint of [
			'/api/database-restores/preparation',
			'/api/recovery-testing/plan-example/preparation',
		]) {
			const result = await call(origin, endpoint, authCookies(login), {
				backupId: 'backup-example',
				snapshotId: 'a'.repeat(64),
			});
			assert.equal(result.status, 200);
			assert.equal(result.headers['access-control-allow-origin'], origin);
		}
		const opposite = origin === publicOrigin ? privateOrigin : publicOrigin;
		assert.equal(
			(
				await call(
					origin,
					'/api/database-restores/preparation',
					authCookies(login),
					{},
					{ Origin: opposite }
				)
			).status,
			403
		);
		const logout = await call(origin, '/api/user/logout', authCookies(login));
		assert.equal(logout.status, 200);
		assert(logout.headers['set-cookie']!.every(item => item.includes('Expires=Thu, 01 Jan 1970')));
	}
	assert.equal(prepared, 2);
	assert.equal(
		(
			await call(
				privateOrigin,
				'/api/database-restores/preparation',
				[],
				{},
				{ 'X-Forwarded-Proto': 'https' }
			)
		).status,
		403
	);
	assert.equal(
		(
			await call(
				privateOrigin,
				'/api/database-restores/preparation',
				[],
				{},
				{ 'X-Forwarded-Host': 'evil.example.invalid' }
			)
		).status,
		403
	);
	console.log(
		'PASS ' +
			(compiled ? 'compiled image' : 'source') +
			' UID 10001: verified local HTTPS terminator -> HTTP upstream and direct LAN HTTP; real login/session cookies, restore/recovery preparation, cross-origin refusal and logout; trust proxy remains disabled.'
	);
} finally {
	await Promise.all([
		new Promise<void>(resolve => proxy.close(() => resolve())),
		new Promise<void>(resolve => backend.close(() => resolve())),
	]);
	store.clear();
	await fs.rm(root, { recursive: true, force: true });
}
