import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import Cookies from 'cookies';
import {
	createDatabaseRestoreRouter,
	databaseRestoreInputError,
} from '../../src/routes/databaseRestores';
jest.mock('jsonwebtoken');
jest.mock('cookies');
jest.mock('../../src/services/ConfigService', () => ({
	configService: {
		config: {
			SECRET: 'synthetic-fixture-key',
			USER_NAME: 'fixture-admin',
			APP_URL: 'https://backup.example.invalid',
		},
	},
}));
describe('Retained restore API administrator, CSRF and input boundary', () => {
	let service: any, app: express.Express, authenticated: boolean, user: string;
	beforeEach(() => {
		authenticated = true;
		user = 'fixture-admin';
		(Cookies as jest.Mock).mockImplementation(() => ({
			get: () => (authenticated ? 'fixture-token' : undefined),
		}));
		(jwt.verify as jest.Mock).mockImplementation((_token, _secret, callback) => {
			if (callback) {
				callback(authenticated ? null : new Error());
				return;
			}
			if (!authenticated) throw new Error();
			return { user };
		});
		service = Object.fromEntries(
			['preview', 'create', 'list', 'get', 'inspect', 'delete', 'operator'].map(key => [
				key,
				jest.fn(async () => ({ id: 'a'.repeat(24) })),
			])
		);
		app = express();
		app.use('/api/database-restores', express.json({ limit: '8kb' }));
		app.use(databaseRestoreInputError);
		app.use('/api/database-restores', createDatabaseRestoreRouter(service));
	});
	it.each([
		'',
		'/a',
		'/a/inspect',
		'/a/delete',
		'/a/provision',
		'/a/stop',
		'/a/resume',
		'/preparation',
	])('requires an authenticated admin at %s', async route => {
		authenticated = false;
		const response = await request(app)
			.post('/api/database-restores' + route)
			.send({});
		expect(response.status).toBe(401);
		expect(response.headers['cache-control']).toBe('no-store');
		Object.values(service).forEach(value => expect(value).not.toHaveBeenCalled());
	});
	it('rejects a valid JWT without the configured admin identity', async () => {
		user = 'other-user';
		expect((await request(app).get('/api/database-restores')).status).toBe(403);
		expect(service.list).not.toHaveBeenCalled();
	});
	it.each([undefined, 'https://attacker.invalid'])(
		'refuses cross-origin mutations (%s)',
		async origin => {
			const req = request(app).post('/api/database-restores/a/delete').send({ confirmation: 'a' });
			if (origin) req.set('Origin', origin);
			expect((await req).status).toBe(403);
			expect(service.delete).not.toHaveBeenCalled();
		}
	);
	it('records the sole administrator owner and never accepts an endpoint for an operator action', async () => {
		const result = await request(app)
			.post('/api/database-restores/a/stop')
			.set('Host', 'backup.example.invalid')
			.set('Origin', 'https://backup.example.invalid')
			.send({});
		expect(result.status).toBe(202);
		expect(service.operator).toHaveBeenCalledWith('a', 'administrator', 'stop');
		const bad = await request(app)
			.post('/api/database-restores/a/resume')
			.set('Host', 'backup.example.invalid')
			.set('Origin', 'https://backup.example.invalid')
			.send({ command: 'sh' });
		expect(bad.status).toBe(400);
		expect(service.operator).toHaveBeenCalledTimes(1);
	});
	it('rejects malformed and oversized JSON without echoing supplied content', async () => {
		for (const body of [
			'{"password":"synthetic-never-echo",',
			JSON.stringify({ value: 'x'.repeat(9000) }),
		]) {
			const result = await request(app)
				.post('/api/database-restores')
				.set('Content-Type', 'application/json')
				.send(body);
			expect([400, 413]).toContain(result.status);
			expect(result.headers['cache-control']).toBe('no-store');
			expect(result.text).not.toContain('synthetic-never-echo');
			expect(service.create).not.toHaveBeenCalled();
		}
	});
	it.each([{ resumeSequence: 99 }, { sequence: 99 }, { version: 2 }, { nonce: 'synthetic' }])(
		'never accepts caller-supplied Resume authority: %j',
		async body => {
			const result = await request(app)
				.post('/api/database-restores/a/resume')
				.set('Host', 'backup.example.invalid')
				.set('Origin', 'https://backup.example.invalid')
				.send(body);
			expect(result.status).toBe(400);
			expect(service.operator).not.toHaveBeenCalled();
		}
	);
});
