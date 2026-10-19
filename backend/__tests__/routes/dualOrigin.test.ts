import express from 'express';
import session from 'express-session';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import Cryptr from 'cryptr';
import * as otpauth from 'otpauth';
import { configService } from '../../src/services/ConfigService';
import { parseWebOrigins } from '../../src/utils/webOrigins';
import { webAccess, originAwareSession, sameOriginCors } from '../../src/middlewares/webAccess';
import { UserController } from '../../src/controllers/UserController';
import { createUserRouter } from '../../src/routes/users';
import { createDatabaseRestoreRouter } from '../../src/routes/databaseRestores';
import { createRecoveryTestRouter } from '../../src/routes/recoveryTests';
import { RecoveryTestController } from '../../src/controllers/RecoveryTestController';
import { createAgentRouter } from '../../src/routes/agents';
import { AgentController } from '../../src/controllers/AgentController';
import { AgentService } from '../../src/services/AgentService';
import { signAgentRequest } from '../../src/utils/agentProtocol';

const publicOrigin = 'https://pluton.example.internal',
	privateOrigin = 'http://192.0.2.10:5173';
const secret = 'synthetic-dual-origin-session-fixture-key';
jest.mock('../../src/services/ConfigService', () => ({
	configService: {
		config: {
			APP_URL: 'https://pluton.example.internal',
			APP_ALLOWED_ORIGINS: 'https://pluton.example.internal,http://192.0.2.10:5173',
			SECRET: 'synthetic-dual-origin-session-fixture-key',
			APIKEY: 'synthetic-fixture-api-key',
			USER_NAME: 'fixture-admin',
			SESSION_DURATION: 7,
			ALLOW_INSECURE_AGENT_HTTP: true,
		},
		verifyPassword: (password: string) => password === 'synthetic-fixture-password',
	},
}));
const cookie = (result: request.Response, name = 'token') => {
	const values = result.headers['set-cookie'] as unknown as string[];
	const value = values.find(item => item.startsWith(name + '='));
	expect(value).toBeDefined();
	return value!;
};
const headers = (action: request.Test, origin = publicOrigin) =>
	action
		.set('Host', new URL(origin).host)
		.set('Origin', origin)
		.set('Sec-Fetch-Site', 'same-origin');
describe('Dual-origin real cookie, authentication, restore and Agent routing', () => {
	let app: express.Express,
		restore: any,
		recovery: any,
		agentStore: any,
		agentService: AgentService,
		store: session.MemoryStore;
	beforeEach(() => {
		const policy = parseWebOrigins(configService.config);
		app = express();
		store = new session.MemoryStore();
		// Default trust proxy remains false. Same middleware order as createApp.
		app.use(webAccess(policy));
		app.use(sameOriginCors(policy));
		app.use(
			originAwareSession(policy, {
				store,
				secret,
				resave: false,
				saveUninitialized: false,
				cookie: { maxAge: 900000 },
			})
		);
		app.use(
			express.json({
				verify(req, _res, buffer) {
					(req as any).rawBody = buffer.toString('utf8');
				},
			})
		);
		const totpSecret = otpauth.Secret.fromBase32('JBSWY3DPEHPK3PXP');
		const settings = {
			getMainSettings: async () => ({
				settings: {
					totp: { enabled: true, secret: new Cryptr(secret).encrypt(totpSecret.base32) },
				},
			}),
		};
		app.use('/api/user', createUserRouter(new UserController(settings as any)));
		restore = Object.fromEntries(
			['preview', 'create', 'list', 'get', 'inspect', 'delete', 'operator'].map(name => [
				name,
				jest.fn(async () => ({ id: 'a'.repeat(24) })),
			])
		);
		recovery = { preparation: jest.fn(async () => ({ snapshotId: 'a'.repeat(64) })) };
		app.use('/api/database-restores', createDatabaseRestoreRouter(restore));
		app.use(
			'/api/recovery-testing',
			createRecoveryTestRouter(new RecoveryTestController(recovery))
		);
		app.get('/api/session-fixture', (req, res) =>
			res.json({
				bound: req.session.webOrigin,
				physicalSecure: req.secure,
				physicalProtocol: req.protocol,
			})
		);
		agentStore = {
			getAgentById: jest.fn(async () => ({
				agentId: 'agent-example',
				deviceId: 'device-example',
				encryptedSecret: new Cryptr(secret).encrypt('synthetic-agent-hmac-key'),
				revokedAt: null,
			})),
			reserveNonce: jest.fn(async () => true),
			updateHeartbeat: jest.fn(async () => ({ lastSeen: new Date() })),
		};
		agentService = new AgentService(agentStore, secret);
		app.use('/api/agent', createAgentRouter(new AgentController(agentService), agentService));
	});
	async function login(origin = publicOrigin) {
		return headers(request(app).post('/api/user/login'), origin).send({
			username: 'fixture-admin',
			password: 'synthetic-fixture-password',
		});
	}
	it.each([publicOrigin, privateOrigin])(
		'authenticates %s with host-only appropriate Secure cookies; prepares both restore paths',
		async origin => {
			const result = await login(origin);
			expect(result.status).toBe(200);
			expect(result.headers['access-control-allow-origin']).toBe(origin);
			const tokenCookie = cookie(result),
				sessionCookie = cookie(result, 'connect.sid');
			for (const value of [tokenCookie, sessionCookie]) {
				expect(value).toContain('HttpOnly');
				expect(value).toContain('SameSite=Lax');
				expect(value).toContain('Path=/');
				expect(value).not.toContain('Domain=');
				expect(/;\s*Secure(?:;|$)/.test(value)).toBe(origin === publicOrigin);
			}
			const auth = tokenCookie.split(';')[0];
			expect(
				(await headers(request(app).get('/api/user/validate'), origin).set('Cookie', auth)).status
			).toBe(200);
			expect(
				(
					await headers(request(app).post('/api/database-restores/preparation'), origin)
						.set('Cookie', auth)
						.send({})
				).status
			).toBe(200);
			expect(
				(
					await headers(request(app).post('/api/recovery-testing/plan-example/preparation'), origin)
						.set('Cookie', auth)
						.send({ backupId: 'backup-example', snapshotId: 'a'.repeat(64) })
				).status
			).toBe(200);
			const context = await headers(request(app).get('/api/session-fixture'), origin).set(
				'Cookie',
				sessionCookie.split(';')[0]
			);
			expect(context.body).toEqual({
				bound: origin,
				physicalSecure: false,
				physicalProtocol: 'http',
			});
		}
	);
	it('uses consistent fixed proxy metadata without enabling Express proxy trust', async () => {
		const result = await headers(request(app).post('/api/user/login'))
			.set('X-Forwarded-Proto', 'https')
			.set('X-Forwarded-Host', 'pluton.example.internal')
			.set('X-Forwarded-Port', '443')
			.send({ username: 'fixture-admin', password: 'synthetic-fixture-password' });
		expect(app.get('trust proxy')).toBe(false);
		expect(result.status).toBe(200);
		expect(cookie(result)).toContain('Secure');
	});
	it('reproduces the original mismatch until canonical public origin is configured', async () => {
		const old = express();
		old.use((req, res) => {
			const allowed = new Set([req.protocol + '://' + req.get('host'), privateOrigin]);
			res.sendStatus(allowed.has(req.headers.origin || '') ? 200 : 403);
		});
		expect(
			(await headers(request(old).post('/api/database-restores/preparation')).send({})).status
		).toBe(403);
		expect((await login()).status).toBe(200);
	});
	it.each([
		['192.0.2.10:5173', publicOrigin, {}],
		['pluton.example.internal', privateOrigin, {}],
		['evil.example.invalid', publicOrigin, {}],
		['pluton.example.internal', 'https://evil.example.invalid', {}],
		['192.0.2.10:5173', privateOrigin, { 'X-Forwarded-Proto': 'https' }],
		['pluton.example.internal', publicOrigin, { 'X-Forwarded-Host': 'evil.example.invalid' }],
		[
			'evil.example.invalid',
			publicOrigin,
			{ 'X-Forwarded-Host': 'pluton.example.internal', 'X-Forwarded-Proto': 'https' },
		],
	])('rejects cross-origin/forged web mutation (%s, %s)', async (host, origin, extra) => {
		const result = await request(app)
			.post('/api/database-restores/preparation')
			.set('Host', host)
			.set('Origin', origin)
			.set(extra)
			.send({});
		expect(result.status).toBe(403);
		expect(restore.preview).not.toHaveBeenCalled();
		expect(result.headers['access-control-allow-origin']).toBeUndefined();
	});
	it('refuses invalid/missing auth, admin identity and non-JSON; cannot use HMAC headers on admin APIs', async () => {
		expect(
			(await headers(request(app).post('/api/database-restores/preparation')).send({})).status
		).toBe(401);
		const foreign = jwt.sign({ user: 'other-user', webOrigin: publicOrigin }, secret);
		expect(
			(
				await headers(request(app).post('/api/database-restores/preparation'))
					.set('Cookie', 'token=' + foreign)
					.send({})
			).status
		).toBe(403);
		const signed = cookie(await login()).split(';')[0];
		expect(
			(
				await headers(request(app).post('/api/database-restores/preparation'))
					.set('Cookie', signed)
					.type('text')
					.send('bad')
			).status
		).toBe(403);
		expect(
			(
				await headers(request(app).post('/api/database-restores/preparation'))
					.set('x-pluton-agent-id', 'agent-example')
					.send({})
			).status
		).toBe(401);
		expect(
			(
				await request(app)
					.post('/api/user/login')
					.set('Host', 'pluton.example.internal')
					.set('Authorization', 'Bearer forged')
					.send({})
			).status
		).toBe(403);
	});
	it('binds new JWTs and temporary sessions to an origin and rotates sessions on login', async () => {
		const first = await login(),
			second = await login();
		const auth = cookie(first).split(';')[0],
			sid = cookie(first, 'connect.sid').split(';')[0];
		expect(cookie(first)).not.toEqual(cookie(second));
		expect(cookie(first, 'connect.sid')).not.toEqual(cookie(second, 'connect.sid'));
		expect(
			(await headers(request(app).get('/api/user/validate'), privateOrigin).set('Cookie', auth))
				.status
		).toBe(401);
		const rebound = await headers(request(app).get('/api/session-fixture'), privateOrigin).set(
			'Cookie',
			sid
		);
		expect(rebound.body.bound).toBe(privateOrigin);
		expect(cookie(rebound, 'connect.sid').split(';')[0]).not.toBe(sid);
		const old = jwt.sign({ user: 'fixture-admin' }, secret);
		const upgraded = await headers(request(app).get('/api/user/validate')).set(
			'Cookie',
			'token=' + old
		);
		expect(upgraded.status).toBe(200);
		expect(cookie(upgraded)).toContain('Secure');
	});
	it.each([publicOrigin, privateOrigin])(
		'logs out %s with matching cookie flags and destroys temporary session',
		async origin => {
			const result = await login(origin),
				sid = cookie(result, 'connect.sid').split(';')[0];
			const response = await headers(request(app).post('/api/user/logout'), origin)
				.set('Cookie', [cookie(result).split(';')[0], sid])
				.send({});
			expect(response.status).toBe(200);
			for (const name of ['token', 'connect.sid']) {
				const value = cookie(response, name);
				expect(value).toContain('Expires=Thu, 01 Jan 1970');
				expect(/;\s*Secure(?:;|$)/.test(value)).toBe(origin === publicOrigin);
			}
			const rows = await new Promise<any>((resolve, reject) =>
				store.all((error, values) => (error ? reject(error) : resolve(values)))
			);
			expect(Object.keys(rows)).toHaveLength(0);
		}
	);
	it.each([publicOrigin, privateOrigin])(
		'OTP login uses the same cookie policy on %s',
		async origin => {
			const totp = new otpauth.TOTP({
				secret: otpauth.Secret.fromBase32('JBSWY3DPEHPK3PXP'),
				algorithm: 'SHA1',
				digits: 6,
				period: 30,
			});
			const result = await headers(request(app).post('/api/user/verify-otp'), origin).send({
				code: totp.generate(),
			});
			expect(result.status).toBe(200);
			expect(/;\s*Secure(?:;|$)/.test(cookie(result))).toBe(origin === publicOrigin);
		}
	);
	it.each(['/api/agent/heartbeat', '/API/AGENT/heartbeat'])(
		'retains real HMAC private HTTP authentication at %s without Origin or web sessions',
		async path => {
			const now = String(Date.now()),
				nonce = 'a'.repeat(32),
				body = JSON.stringify({
					hostname: 'app-01',
					os: 'Example Linux',
					architecture: 'x64',
					agentVersion: '0.4.0',
					capabilities: { commandTypes: ['PING'], filesystemRootsConfigured: true },
				});
			const signature = signAgentRequest(
				'synthetic-agent-hmac-key',
				now,
				nonce,
				'POST',
				path,
				body
			);
			const result = await request(app)
				.post(path)
				.set('Host', '192.0.2.10:5173')
				.set('Content-Type', 'application/json')
				.set('x-pluton-agent-id', 'agent-example')
				.set('x-pluton-agent-timestamp', now)
				.set('x-pluton-agent-nonce', nonce)
				.set('x-pluton-agent-signature', signature)
				.send(body);
			expect(result.status).toBe(200);
			expect(result.headers['set-cookie']).toBeUndefined();
			expect(agentStore.reserveNonce).toHaveBeenCalled();
			expect(agentStore.updateHeartbeat).toHaveBeenCalled();
		}
	);
	it('cannot use the web HTTPS mapping or forged proxy headers to bypass Agent transport policy', async () => {
		(configService.config as any).ALLOW_INSECURE_AGENT_HTTP = false;
		try {
			const result = await request(app)
				.post('/API/AGENT/heartbeat')
				.set('Host', 'pluton.example.internal')
				.set('X-Forwarded-Proto', 'https')
				.send({});
			expect(result.status).toBe(403);
			expect(agentStore.getAgentById).not.toHaveBeenCalled();
		} finally {
			(configService.config as any).ALLOW_INSECURE_AGENT_HTTP = true;
		}
	});
	it('never treats Agent admin paths as machine-authenticated routes', async () => {
		const result = await request(app)
			.post('/api/agent-admin/enrollment-tokens')
			.set('Host', 'pluton.example.internal')
			.set('x-pluton-agent-id', 'agent-example')
			.send({});
		expect(result.status).toBe(403);
		expect(agentStore.getAgentById).not.toHaveBeenCalled();
	});
	it('does not allocate session cookies/state for anonymous API reads', async () => {
		const result = await request(app)
			.get('/api/session-fixture')
			.set('Host', 'pluton.example.internal');
		expect(result.headers['set-cookie']).toBeUndefined();
		const rows = await new Promise<any>((resolve, reject) =>
			store.all((error, values) => (error ? reject(error) : resolve(values)))
		);
		expect(Object.keys(rows)).toHaveLength(0);
	});
});
