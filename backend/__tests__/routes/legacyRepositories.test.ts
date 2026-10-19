import express, { type Express } from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import Cookies from 'cookies';
import { Readable } from 'stream';

jest.mock('jsonwebtoken');
jest.mock('cookies');
jest.mock('../../src/services/ConfigService', () => ({
	configService: {
		config: {
			SECRET: 'legacy-routes-test-secret',
			APIKEY: 'legacy-routes-test-api-key',
		},
	},
}));

import { LegacyRepositoryController } from '../../src/controllers/LegacyRepositoryController';
import { createLegacyRepositoryRouter } from '../../src/routes/legacyRepositories';
import type { LegacyRepositoryService } from '../../src/services/LegacyRepositoryService';

describe('Legacy repository routes', () => {
	let app: Express;
	let service: {
		getAll: jest.Mock;
		getById: jest.Mock;
		register: jest.Mock;
		validate: jest.Mock;
		listSnapshots: jest.Mock;
		getSnapshot: jest.Mock;
		listSnapshotDirectory: jest.Mock;
		getStats: jest.Mock;
		startRestore: jest.Mock;
		getRestoreJob: jest.Mock;
		cancelRestore: jest.Mock;
		openRestoredFile: jest.Mock;
		deleteRegistration: jest.Mock;
	};

	const setAuthenticatedSession = (authenticated: boolean) => {
		(Cookies as jest.MockedClass<typeof Cookies>).mockImplementation(
			() => ({ get: jest.fn().mockReturnValue(authenticated ? 'test-session' : undefined) }) as never
		);
		(jwt.verify as jest.Mock).mockImplementation((_token, _secret, callback) => {
			callback(authenticated ? null : new Error('invalid session'));
		});
	};

	beforeEach(() => {
		jest.clearAllMocks();
		service = {
			getAll: jest.fn(),
			getById: jest.fn(),
			register: jest.fn(),
			validate: jest.fn(),
			listSnapshots: jest.fn(),
			getSnapshot: jest.fn(),
			listSnapshotDirectory: jest.fn(),
			getStats: jest.fn(),
			startRestore: jest.fn(),
			getRestoreJob: jest.fn(),
			cancelRestore: jest.fn(),
			openRestoredFile: jest.fn(),
			deleteRegistration: jest.fn(),
		};
		app = express();
		app.use(express.json());
		app.use(
			'/api/legacy-repositories',
			createLegacyRepositoryRouter(new LegacyRepositoryController(service as unknown as LegacyRepositoryService))
		);
		setAuthenticatedSession(true);
	});

	it('requires an authenticated UI session', async () => {
		setAuthenticatedSession(false);

		const response = await request(app).get('/api/legacy-repositories');

		expect(response.status).toBe(401);
		expect(service.getAll).not.toHaveBeenCalled();
	});

	it('does not grant a legacy repository route to an API key', async () => {
		setAuthenticatedSession(false);

		const response = await request(app)
			.get('/api/legacy-repositories')
			.set('Authorization', 'Bearer legacy-routes-test-api-key');

		expect(response.status).toBe(401);
		expect(service.getAll).not.toHaveBeenCalled();
	});

	it('lists public registration data without credentials', async () => {
		service.getAll.mockResolvedValue([
			{
				id: 'legacy-fixture',
				displayName: 'Fixture legacy repository',
				repositoryPath: 'C:\\fixtures\\legacy-restic-repository',
				backend: 'local',
				isReadOnly: true,
				validationStatus: 'available',
				lastValidatedAt: null,
				createdAt: new Date('2026-01-01T00:00:00.000Z'),
				updatedAt: null,
			},
		]);

		const response = await request(app).get('/api/legacy-repositories');

		expect(response.status).toBe(200);
		expect(response.body).toMatchObject({ success: true });
		expect(JSON.stringify(response.body)).not.toContain('password');
	});

	it('passes exact snapshot filters to the read-only service', async () => {
		service.listSnapshots.mockResolvedValue({
			items: [],
			total: 0,
			page: 1,
			pageSize: 30,
			totalPages: 0,
			workloads: [],
			datasets: [],
		});

		const response = await request(app)
			.get('/api/legacy-repositories/legacy-fixture/snapshots')
			.query({ tag: 'application', path: 'C:\\fixtures\\source', host: 'fixture-host' });

		expect(response.status).toBe(200);
		expect(service.listSnapshots).toHaveBeenCalledWith('legacy-fixture', {
			tag: 'application',
			path: 'C:\\fixtures\\source',
			host: 'fixture-host',
		});
	});

	it('forwards grouping and pagination query parameters', async () => {
		service.listSnapshots.mockResolvedValue({
			items: [],
			total: 809,
			page: 2,
			pageSize: 30,
			totalPages: 27,
			workloads: ['workload-a'],
			datasets: ['mysql-plain'],
		});

		const response = await request(app)
			.get('/api/legacy-repositories/legacy-fixture/snapshots')
			.query({ workload: 'workload-a', dataset: 'mysql-plain', page: '2', pageSize: '30' });

		expect(response.status).toBe(200);
		expect(response.body.result).toEqual(expect.objectContaining({ total: 809, totalPages: 27 }));
		expect(service.listSnapshots).toHaveBeenCalledWith('legacy-fixture', {
			workload: 'workload-a',
			dataset: 'mysql-plain',
			page: '2',
			pageSize: '30',
		});
	});

	it('requires a UI session for snapshot browsing, restore creation, and restored-file download', async () => {
		setAuthenticatedSession(false);

		const [tree, restore, download] = await Promise.all([
			request(app).get(`/api/legacy-repositories/legacy-fixture/snapshots/${'a'.repeat(64)}/tree`),
			request(app).post('/api/legacy-repositories/legacy-fixture/restores').send({ snapshotId: 'a'.repeat(64), paths: ['app-01/index.txt'] }),
			request(app)
				.get(`/api/legacy-repositories/legacy-fixture/restores/${'b'.repeat(24)}/files`)
				.query({ path: 'app-01/index.txt' }),
		]);

		expect(tree.status).toBe(401);
		expect(restore.status).toBe(401);
		expect(download.status).toBe(401);
		expect(service.listSnapshotDirectory).not.toHaveBeenCalled();
		expect(service.startRestore).not.toHaveBeenCalled();
		expect(service.openRestoredFile).not.toHaveBeenCalled();
	});

	it('forwards a safe browser request and queues a staged restore through the service', async () => {
		service.listSnapshotDirectory.mockResolvedValue({ path: 'app-01', entries: [] });
		service.startRestore.mockResolvedValue({ id: 'b'.repeat(24), status: 'queued' });

		const tree = await request(app)
			.get(`/api/legacy-repositories/legacy-fixture/snapshots/${'a'.repeat(64)}/tree`)
			.query({ path: 'app-01' });
		const restore = await request(app)
			.post('/api/legacy-repositories/legacy-fixture/restores')
			.send({ snapshotId: 'a'.repeat(64), paths: ['app-01/index.txt'] });

		expect(tree.status).toBe(200);
		expect(restore.status).toBe(202);
		expect(service.listSnapshotDirectory).toHaveBeenCalledWith('legacy-fixture', 'a'.repeat(64), 'app-01');
		expect(service.startRestore).toHaveBeenCalledWith('legacy-fixture', {
			snapshotId: 'a'.repeat(64),
			paths: ['app-01/index.txt'],
		});
	});

	it('streams only the safe file handle returned by the service with an attachment disposition', async () => {
		service.openRestoredFile.mockResolvedValue({
			fileName: 'example.txt',
			size: 7,
			fileHandle: { createReadStream: () => Readable.from(['fixture']) },
		});

		const response = await request(app)
			.get(`/api/legacy-repositories/legacy-fixture/restores/${'b'.repeat(24)}/files`)
			.query({ path: 'app-01/index.txt' });

		expect(response.status).toBe(200);
		expect(response.body.toString()).toBe('fixture');
		expect(response.headers['content-disposition']).toContain('attachment;');
		expect(response.headers['content-disposition']).toContain('example.txt');
		expect(service.openRestoredFile).toHaveBeenCalledWith('legacy-fixture', 'b'.repeat(24), 'app-01/index.txt');
	});
});
