import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { notificationFixture, fixtureSecret } from '../fixtures/notifications';
import { createNotificationRouter, notificationInputError } from '../../src/routes/notifications';
jest.mock('../../src/services/ConfigService', () => ({
	configService: {
		config: {
			SECRET: 'synthetic-session-secret',
			APIKEY: 'synthetic-api-key',
			APP_URL: 'https://app.example.internal',
		},
	},
}));
describe('authenticated notification administration', () => {
	let fixture: ReturnType<typeof notificationFixture>;
	let app: express.Express;
	const cookie = `token=${jwt.sign({ user: 'fixture-admin' }, 'synthetic-session-secret')}`;
	beforeEach(() => {
		fixture = notificationFixture();
		app = express();
		app.use(express.json());
		app.use(notificationInputError);
		app.use('/api/notifications', createNotificationRouter(fixture.store));
	});
	afterEach(() => fixture.sqlite.close());
	const approved = (action: any) =>
		action
			.set('Host', 'app.example.internal')
			.set('Cookie', cookie)
			.set('Origin', 'https://app.example.internal')
			.set('Content-Type', 'application/json');
	it.each(['get', 'post', 'put', 'delete'])('rejects unauthenticated %s access', async method => {
		const result = await (request(app) as any)[method]('/api/notifications/channels').send({});
		expect(result.status).toBe(401);
	});
	it('refuses API-key-only administration and cross-origin / missing-origin mutations', async () => {
		expect(
			(
				await request(app)
					.get('/api/notifications/channels')
					.set('Authorization', 'Bearer synthetic-api-key')
			).status
		).toBe(401);
		expect(
			(
				await request(app)
					.post('/api/notifications/channels')
					.set('Cookie', cookie)
					.send(fixture.channel())
			).status
		).toBe(403);
		expect(
			(
				await request(app)
					.post('/api/notifications/channels')
					.set('Cookie', cookie)
					.set('Origin', 'https://attacker.example.invalid')
					.send(fixture.channel())
			).status
		).toBe(403);
	});
	it('creates/edits channels without returning credentials, and queues tests instead of claiming delivery success', async () => {
		const created = await approved(request(app).post('/api/notifications/channels')).send(
			fixture.channel()
		);
		expect(created.status).toBe(201);
		expect(created.body.result.secretConfigured).toBe(true);
		expect(JSON.stringify(created.body)).not.toContain(fixtureSecret);
		const channel = created.body.result;
		const updated = await approved(
			request(app).put(`/api/notifications/channels/${channel.id}`)
		).send({ ...fixture.channel(), secret: undefined, name: 'Edited' });
		expect(updated.status).toBe(200);
		expect(fixture.store.channelSecret(channel.id)).toBe(fixtureSecret);
		const tested = await approved(
			request(app).post(`/api/notifications/channels/${channel.id}/test`)
		).send({});
		expect(tested.status).toBe(202);
		expect(tested.body.result.status).toBe('pending');
		expect(tested.body.result.eventType).toBe('notification.test');
		expect(tested.body.result.leaseOwner).toBeUndefined();
		const history = await request(app).get('/api/notifications/deliveries').set('Cookie', cookie);
		expect(history.status).toBe(200);
		expect(history.headers['cache-control']).toBe('no-store');
		expect(history.body.result).toHaveLength(1);
		expect(JSON.stringify(history.body)).not.toContain(fixtureSecret);
		const deleted = await approved(
			request(app).delete(`/api/notifications/channels/${channel.id}`)
		);
		expect(deleted.status).toBe(200);
		expect(fixture.store.channel(channel.id)?.deleted).toBe(true);
	});
	it('never echoes credentials quoted by malformed JSON parser errors', async () => {
		const response = await approved(request(app).post('/api/notifications/channels')).send(
			`{"secret":"${fixtureSecret}`
		);
		expect(response.status).toBe(400);
		expect(JSON.stringify(response.body)).not.toContain(fixtureSecret);
		expect(response.body.error).toBe('Invalid or oversized notification/settings JSON payload.');
	});
	it('validates subscriptions, unsafe destinations and history pagination without echoing submitted values', async () => {
		const c = fixture.store.saveChannel(fixture.channel());
		const saved = await approved(request(app).put('/api/notifications/plans/plan-01')).send({
			enabled: true,
			channelIds: [c.id],
			events: ['backup.failed'],
		});
		expect(saved.status).toBe(200);
		const unsafe = await approved(request(app).post('/api/notifications/channels')).send({
			...fixture.channel(),
			config: { ...fixture.channel().config, url: `https://user:${fixtureSecret}@example.invalid` },
		});
		expect(unsafe.status).toBe(400);
		expect(JSON.stringify(unsafe.body)).not.toContain(fixtureSecret);
		expect(
			(await request(app).get('/api/notifications/deliveries?page=-1').set('Cookie', cookie)).status
		).toBe(400);
	});
	it('allows only eligible bounded retries, and enforces test/retry request limits', async () => {
		const c = fixture.store.saveChannel(fixture.channel());
		const row = fixture.store.test(c.id);
		const ineligible = await approved(
			request(app).post(`/api/notifications/deliveries/${row.id}/retry`)
		).send({});
		expect(ineligible.status).toBe(409);
		fixture.store.finish(fixture.store.claim('worker')!, { success: false, code: 'http-rejected' });
		const retry = await approved(
			request(app).post(`/api/notifications/deliveries/${row.id}/retry`)
		).send({});
		expect(retry.status).toBe(202);
		for (let n = 0; n < 8; n++)
			expect(
				(await approved(request(app).post(`/api/notifications/channels/${c.id}/test`)).send({}))
					.status
			).toBe(202);
		expect(
			(await approved(request(app).post(`/api/notifications/channels/${c.id}/test`)).send({}))
				.status
		).toBe(429);
	});
});
