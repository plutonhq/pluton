import express from 'express';
import request from 'supertest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { registerSpaFallback } from '../../src/utils/spaFallback';
describe('bundled public documentation deep links', () => {
	let directory: string;
	beforeAll(async () => {
		directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pluton-docs-'));
		await fs.writeFile(
			path.join(directory, 'index.html'),
			'<!doctype html><div id="root">static documentation bundle</div>'
		);
		await fs.mkdir(path.join(directory, 'docs'));
		await fs.writeFile(
			path.join(directory, 'docs', 'index.html'),
			'<!doctype html><div>Fumadocs static document</div>'
		);
		await fs.writeFile(path.join(directory, 'docs', 'search-index.json'), '{"synthetic":true}');
	});
	afterAll(async () => {
		await fs.rm(directory, { recursive: true, force: true });
	});
	it.each(['/docs', '/docs/backup-plans/incremental', '/docs/unknown', '/login'])(
		'serves SPA entry without application inventory for direct refresh %s',
		async route => {
			const app = express();
			registerSpaFallback(app, directory);
			const result = await request(app).get(route).expect(200);
			expect(result.headers['content-type']).toContain('text/html');
			expect(result.text).toContain(
				route.startsWith('/docs') ? 'Fumadocs static document' : 'static documentation bundle'
			);
		}
	);
	it('does not intercept registered authenticated API routes', async () => {
		const app = express();
		app.get('/api/settings', (_req, res) =>
			res.status(401).json({ error: 'Authentication required.' })
		);
		registerSpaFallback(app, directory);
		await request(app).get('/api/settings').expect(401).expect('Content-Type', /json/);
	});
	it.each(['get', 'post', 'put', 'patch', 'delete'] as const)(
		'returns JSON 404 for an unmatched API %s rather than SPA/error HTML',
		async method => {
			const app = express();
			registerSpaFallback(app, directory);
			await request(app)[method]('/api/missing-resource')
				.expect(404)
				.expect('Content-Type', /json/)
				.expect({ success: false, error: 'API route not found.' });
		}
	);
	it('returns JSON for malformed API input without reaching a mutation', async () => {
		const app = express(), mutate = jest.fn();
		app.use(express.json());
		app.delete('/api/plans/synthetic', mutate);
		registerSpaFallback(app, directory);
		await request(app).delete('/api/plans/synthetic').set('Content-Type', 'application/json')
			.send('{broken').expect(400).expect('Content-Type', /json/)
			.expect({ success: false, error: 'Invalid API request.' });
		expect(mutate).not.toHaveBeenCalled();
	});
	it('redacts uncaught asynchronous API errors without changing their failure status', async () => {
		const app = express();
		app.delete('/api/plans/synthetic', async () => { throw new Error('private-provider-details'); });
		registerSpaFallback(app, directory);
		const response = await request(app).delete('/api/plans/synthetic').expect(500).expect('Content-Type', /json/);
		expect(response.body.success).toBe(false);
		expect(response.text).not.toContain('private-provider-details');
	});
	it('preserves a registered deletion response and calls its handler exactly once', async () => {
		const app = express(), mutation = jest.fn();
		app.delete('/api/plans/synthetic', (_req, res) => { mutation(); res.status(200).json({ success: true }); });
		registerSpaFallback(app, directory);
		await request(app).delete('/api/plans/synthetic').expect(200).expect({ success: true });
		expect(mutation).toHaveBeenCalledTimes(1);
	});
	it.each(['/docs/assets/missing.js', '/docs/missing-index.json', '/docs/licenses/missing.txt'])(
		'fails with 404 instead of returning executable HTML for missing asset %s',
		async route => {
			const app = express();
			registerSpaFallback(app, directory);
			const response = await request(app).get(route).expect(404);
			expect(response.text).not.toContain('Fumadocs static document');
		}
	);
	it('serves same-origin static search as JSON and HEAD metadata without an API read', async () => {
		const app = express();
		app.use((_req, res, next) => {
			res.setHeader('X-App-Version', 'unknown');
			next();
		});
		app.use(express.static(directory));
		registerSpaFallback(app, directory);
		await request(app)
			.get('/docs/search-index.json')
			.expect(200)
			.expect('Content-Type', /json/)
			.expect({ synthetic: true });
		await request(app)
			.head('/docs/backup-plans/incremental')
			.expect(200)
			.expect('X-App-Version', 'unknown');
	});
});
