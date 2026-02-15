import request from 'supertest';
import express, { Express } from 'express';
import { createPlanRouter } from '../../src/routes/plans';
import { PlanController } from '../../src/controllers/PlanController';
import { PlanService } from '../../src/services/PlanService';
import jwt from 'jsonwebtoken';
import Cookies from 'cookies';

jest.mock('jsonwebtoken');
jest.mock('cookies');
jest.mock('../../src/services/ConfigService', () => ({
	configService: {
		config: {
			SECRET: 'test-secret',
		},
	},
}));

describe('Plan Routes', () => {
	let app: Express;
	let planController: PlanController;
	let mockPlanService: jest.Mocked<PlanService>;

	// Helper function to setup auth mocking
	const setupAuthMock = (authenticated: boolean) => {
		if (authenticated) {
			(Cookies as jest.MockedClass<typeof Cookies>).mockImplementation(
				() =>
					({
						get: jest.fn().mockReturnValue('valid-token'),
					}) as any
			);
			(jwt.verify as jest.Mock).mockImplementation((token, secret, callback) => {
				callback(null, { user: 'testuser' });
			});
		} else {
			(Cookies as jest.MockedClass<typeof Cookies>).mockImplementation(
				() =>
					({
						get: jest.fn().mockReturnValue(null),
					}) as any
			);
		}
	};

	beforeEach(() => {
		jest.clearAllMocks();

		mockPlanService = {
			getAllPlans: jest.fn(),
			getPlan: jest.fn(),
			createPlan: jest.fn(),
			updatePlan: jest.fn(),
			deletePlan: jest.fn(),
			getPlanLogs: jest.fn(),
			downloadPlanLogs: jest.fn(),
			checkActiveBackupsOrRestore: jest.fn(),
			performBackup: jest.fn(),
			resumeBackup: jest.fn(),
			pauseBackup: jest.fn(),
			pruneBackups: jest.fn(),
			unlockRepo: jest.fn(),
		} as any;

		planController = new PlanController(mockPlanService);

		app = express();
		app.use(express.json());
		app.use('/api/plans', createPlanRouter(planController));

		// Default to authenticated for most tests
		setupAuthMock(true);
	});

	describe('GET /api/plans', () => {
		it('should return 401 if not authenticated', async () => {
			setupAuthMock(false);

			const response = await request(app).get('/api/plans');

			expect(response.status).toBe(401);
		});

		it('should return list of plans when authenticated', async () => {
			mockPlanService.getAllPlans.mockResolvedValue([
				{ id: '1', name: 'Plan 1' },
				{ id: '2', name: 'Plan 2' },
			] as any);

			const response = await request(app).get('/api/plans');

			expect(response.status).toBe(200);
			expect(mockPlanService.getAllPlans).toHaveBeenCalled();
		});
	});

	describe('GET /api/plans/:id', () => {
		it('should return 401 if not authenticated', async () => {
			setupAuthMock(false);

			const response = await request(app).get('/api/plans/plan-1');

			expect(response.status).toBe(401);
		});

		it('should return a specific plan when authenticated', async () => {
			mockPlanService.getPlan.mockResolvedValue({ id: 'plan-1', name: 'Test Plan' } as any);

			const response = await request(app).get('/api/plans/plan-1');

			expect(response.status).toBe(200);
			expect(mockPlanService.getPlan).toHaveBeenCalledWith('plan-1', true);
		});
	});

	describe('POST /api/plans', () => {
		it('should return 401 if not authenticated', async () => {
			setupAuthMock(false);

			const response = await request(app)
				.post('/api/plans')
				.send({
					settings: { interval: '0 0 * * *' },
					storage: { id: 'storage-1' },
					sourceType: 'device',
					sourceConfig: { id: 'device-1' },
				});

			expect(response.status).toBe(401);
		});

		it('should create a new plan when authenticated', async () => {
			const newPlan = { id: 'plan-1', name: 'New Plan' };
			mockPlanService.createPlan.mockResolvedValue(newPlan as any);

			const response = await request(app)
				.post('/api/plans')
				.send({
					settings: { interval: '0 0 * * *' },
					storage: { id: 'storage-1' },
					sourceType: 'device',
					sourceConfig: { id: 'device-1' },
				});

			expect(response.status).toBe(201);
			expect(mockPlanService.createPlan).toHaveBeenCalled();
		});
	});

	describe('PUT /api/plans/:id', () => {
		it('should return 401 if not authenticated', async () => {
			setupAuthMock(false);

			const response = await request(app)
				.put('/api/plans/plan-1')
				.send({
					plan: {
						settings: { interval: '0 0 * * *' },
						storage: { id: 'storage-1' },
						sourceType: 'device',
						sourceConfig: { id: 'device-1' },
					},
				});

			expect(response.status).toBe(401);
		});

		it('should update a plan when authenticated', async () => {
			mockPlanService.updatePlan.mockResolvedValue({ id: 'plan-1', name: 'Updated Plan' } as any);

			const planUpdate = {
				settings: { interval: '0 0 * * *' },
				storage: { id: 'storage-1' },
				sourceType: 'device',
				sourceConfig: { id: 'device-1' },
			};

			const response = await request(app).put('/api/plans/plan-1').send({ plan: planUpdate });

			expect(response.status).toBe(200);
			expect(mockPlanService.updatePlan).toHaveBeenCalledWith('plan-1', planUpdate);
		});
	});

	describe('DELETE /api/plans/:id', () => {
		it('should return 401 if not authenticated', async () => {
			setupAuthMock(false);

			const response = await request(app).delete('/api/plans/plan-1');

			expect(response.status).toBe(401);
		});

		it('should delete a plan when authenticated', async () => {
			mockPlanService.deletePlan.mockResolvedValue(true);

			const response = await request(app).delete('/api/plans/plan-1');

			expect(response.status).toBe(200);
			expect(mockPlanService.deletePlan).toHaveBeenCalledWith('plan-1', false);
		});
	});

	describe('GET /api/plans/:id/logs', () => {
		it('should return logs for a plan when authenticated', async () => {
			mockPlanService.getPlanLogs.mockResolvedValue([
				{ timestamp: '2024-01-01', message: 'log entry' },
			] as any);

			const response = await request(app).get('/api/plans/plan-1/logs');

			expect(response.status).toBe(200);
			expect(mockPlanService.getPlanLogs).toHaveBeenCalledWith('plan-1');
		});
	});

	describe('GET /api/plans/:id/logs/download', () => {
		it('should initiate log download for a plan when authenticated', async () => {
			// For streaming responses, we just verify the service was called
			mockPlanService.downloadPlanLogs.mockImplementation(async () => {
				throw new Error('Stream test - expected');
			});

			const response = await request(app).get('/api/plans/plan-1/logs/download');

			expect(mockPlanService.downloadPlanLogs).toHaveBeenCalledWith('plan-1');
			expect(response.status).toBe(500); // Error because we threw in mock
		});
	});

	describe('GET /api/plans/:id/checkactive', () => {
		it('should check active backups for a plan when authenticated', async () => {
			mockPlanService.checkActiveBackupsOrRestore.mockResolvedValue(false);

			const response = await request(app).get('/api/plans/plan-1/checkactive');

			expect(response.status).toBe(200);
			expect(mockPlanService.checkActiveBackupsOrRestore).toHaveBeenCalledWith('plan-1', 'backup');
		});
	});

	describe('POST /api/plans/:id/action/backup', () => {
		it('should perform backup for a plan when authenticated', async () => {
			mockPlanService.performBackup.mockResolvedValue({ success: true } as any);

			const response = await request(app).post('/api/plans/plan-1/action/backup');

			expect(response.status).toBe(200);
			expect(mockPlanService.performBackup).toHaveBeenCalledWith('plan-1');
		});
	});

	describe('POST /api/plans/:id/action/resume', () => {
		it('should resume backup for a plan when authenticated', async () => {
			mockPlanService.resumeBackup.mockResolvedValue({ success: true } as any);

			const response = await request(app).post('/api/plans/plan-1/action/resume');

			expect(response.status).toBe(200);
			expect(mockPlanService.resumeBackup).toHaveBeenCalledWith('plan-1');
		});
	});

	describe('POST /api/plans/:id/action/pause', () => {
		it('should pause backup for a plan when authenticated', async () => {
			mockPlanService.pauseBackup.mockResolvedValue({ success: true } as any);

			const response = await request(app).post('/api/plans/plan-1/action/pause');

			expect(response.status).toBe(200);
			expect(mockPlanService.pauseBackup).toHaveBeenCalledWith('plan-1');
		});
	});

	describe('POST /api/plans/:id/action/prune', () => {
		it('should prune backup for a plan when authenticated', async () => {
			mockPlanService.pruneBackups.mockResolvedValue('Pruned successfully' as any);

			const response = await request(app).post('/api/plans/plan-1/action/prune');

			expect(response.status).toBe(200);
			expect(mockPlanService.pruneBackups).toHaveBeenCalledWith('plan-1');
		});
	});

	describe('POST /api/plans/:id/action/unlock', () => {
		it('should unlock repository for a plan when authenticated', async () => {
			mockPlanService.unlockRepo.mockResolvedValue({ success: true } as any);

			const response = await request(app).post('/api/plans/plan-1/action/unlock');

			expect(response.status).toBe(200);
			expect(mockPlanService.unlockRepo).toHaveBeenCalledWith('plan-1');
		});
	});
});
