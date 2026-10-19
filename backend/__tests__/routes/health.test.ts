import express from 'express';
import request from 'supertest';
import { db } from '../../src/db';
import { createHealthRouter } from '../../src/routes/health';
import { webAccess } from '../../src/middlewares/webAccess';
import { parseWebOrigins } from '../../src/utils/webOrigins';

jest.mock('../../src/db', () => ({ db: { run: jest.fn() } }));
jest.mock('../../src/middlewares/authMiddleware', () => ({
	__esModule: true,
	default: (_req: any, res: any) => res.status(401).json({ success: false }),
}));

describe('Precisely scoped deployment health under strict web origin policy', () => {
	let app: express.Express;
	beforeEach(() => {
		jest.clearAllMocks();
		(db.run as jest.Mock).mockImplementation(() => undefined);
		app = express();
		app.use(webAccess(parseWebOrigins({
			APP_URL: 'https://pluton.example.internal',
			APP_ALLOWED_ORIGINS: 'https://pluton.example.internal,http://192.0.2.10:5173',
		} as any)));
		app.use('/api/health', createHealthRouter());
	});
	it('GET loopback health is ready only after the database check succeeds; trust proxy stays disabled', async () => {
		const result = await request(app).get('/api/health').set('Host', '127.0.0.1:5173');
		expect(result.status).toBe(200);
		expect(result.body).toEqual({ status: 'healthy' });
		expect(db.run).toHaveBeenCalledWith('SELECT 1');
		expect(app.get('trust proxy')).toBe(false);
	});
	it('HEAD/spider is rejected rather than broadening the browser Host exemption', async () => {
		expect((await request(app).head('/api/health').set('Host', '127.0.0.1:5173')).status).toBe(403);
	});
	it.each(['/api/health/details', '/api/health/other', '/api/health-details'])('does not exempt %s', async path => {
		expect((await request(app).get(path).set('Host', '127.0.0.1:5173')).status).toBe(403);
	});
	it('does not exempt state-changing requests or remove detailed-health authentication', async () => {
		expect((await request(app).post('/api/health').set('Host', '127.0.0.1:5173')).status).toBe(403);
		expect((await request(app).get('/api/health/details').set('Host', 'pluton.example.internal')).status).toBe(401);
	});
	it('database failure returns 503 with no raw error, credentials or internal metadata', async () => {
		(db.run as jest.Mock).mockImplementation(() => { throw new Error('private fixture error must not escape'); });
		const result = await request(app).get('/api/health').set('Host', '127.0.0.1:5173');
		expect(result.status).toBe(503);
		expect(result.body).toEqual({ status: 'unhealthy' });
	});
});
