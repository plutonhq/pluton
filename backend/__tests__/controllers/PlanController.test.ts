import { Request, Response } from 'express';
import { PlanController } from '../../src/controllers/PlanController';
import { PlanService } from '../../src/services/PlanService';
import { AppError } from '../../src/utils/AppError';

jest.mock('../../src/services/PlanService');

describe('PlanController', () => {
	let planController: PlanController;
	let mockPlanService: jest.Mocked<PlanService>;
	let mockRequest: Partial<Request>;
	let mockResponse: Partial<Response>;
	let mockJson: jest.Mock;
	let mockStatus: jest.Mock;
	let mockPipe: jest.Mock;
	let mockSetHeader: jest.Mock;

	beforeEach(() => {
		jest.clearAllMocks();

		mockPlanService = new PlanService(
			null as any,
			null as any,
			null as any,
			null as any,
			null as any,
			null as any
		) as jest.Mocked<PlanService>;

		mockJson = jest.fn().mockReturnThis();
		mockStatus = jest.fn().mockReturnValue({ json: mockJson });
		mockPipe = jest.fn();
		mockSetHeader = jest.fn();

		mockResponse = {
			json: mockJson,
			status: mockStatus,
			setHeader: mockSetHeader,
		};

		mockRequest = {
			params: {},
			query: {},
			body: {},
		};

		planController = new PlanController(mockPlanService);
	});

	describe('getPlans', () => {
		it('should successfully get all plans', async () => {
			const mockPlans = [
				{ id: 'plan-1', name: 'Plan 1' },
				{ id: 'plan-2', name: 'Plan 2' },
			];
			mockPlanService.getAllPlans.mockResolvedValue(mockPlans as any);

			await planController.getPlans(mockRequest as Request, mockResponse as Response);

			expect(mockPlanService.getAllPlans).toHaveBeenCalled();
			expect(mockStatus).toHaveBeenCalledWith(200);
			expect(mockJson).toHaveBeenCalledWith({
				success: true,
				result: mockPlans,
			});
		});

		it('should return empty array if no plans exist', async () => {
			mockPlanService.getAllPlans.mockResolvedValue(null);

			await planController.getPlans(mockRequest as Request, mockResponse as Response);

			expect(mockJson).toHaveBeenCalledWith({
				success: true,
				result: [],
			});
		});

		it('should return 500 if service throws an error', async () => {
			const error = new AppError(500, 'Database error');
			mockPlanService.getAllPlans.mockRejectedValue(error);

			await planController.getPlans(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(500);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Internal Server Error. Details: Database error',
			});
		});
	});

	describe('getPlan', () => {
		it('should return 400 if plan ID is missing', async () => {
			mockRequest.params = {};

			await planController.getPlan(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(400);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Plan ID is required',
			});
		});

		it('should successfully get a plan', async () => {
			const mockPlan = { id: 'plan-1', name: 'Plan 1' };
			mockRequest.params = { id: 'plan-1' };
			mockPlanService.getPlan.mockResolvedValue(mockPlan as any);

			await planController.getPlan(mockRequest as Request, mockResponse as Response);

			expect(mockPlanService.getPlan).toHaveBeenCalledWith('plan-1', true);
			expect(mockStatus).toHaveBeenCalledWith(200);
			expect(mockJson).toHaveBeenCalledWith({
				success: true,
				result: mockPlan,
			});
		});

		it('should return 404 if plan not found', async () => {
			mockRequest.params = { id: 'plan-1' };
			const error = new AppError(404, 'Plan not found');
			mockPlanService.getPlan.mockRejectedValue(error);

			await planController.getPlan(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(404);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Plan not found',
			});
		});
	});

	describe('checkActiveBackupsOrRestore', () => {
		it('should return 400 if plan ID is missing', async () => {
			mockRequest.params = {};

			await planController.checkActiveBackupsOrRestore(
				mockRequest as Request,
				mockResponse as Response
			);

			expect(mockStatus).toHaveBeenCalledWith(400);
		});

		it('should successfully check for active backups', async () => {
			mockRequest.params = { id: 'plan-1' };
			mockRequest.query = { type: 'backup' };
			mockPlanService.checkActiveBackupsOrRestore.mockResolvedValue(true);

			await planController.checkActiveBackupsOrRestore(
				mockRequest as Request,
				mockResponse as Response
			);

			expect(mockPlanService.checkActiveBackupsOrRestore).toHaveBeenCalledWith('plan-1', 'backup');
			expect(mockStatus).toHaveBeenCalledWith(200);
			expect(mockJson).toHaveBeenCalledWith({
				success: true,
				result: true,
			});
		});
	});

	describe('createPlan', () => {
		it('should return 400 if required fields are missing', async () => {
			mockRequest.body = {};

			await planController.createPlan(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(400);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Required fields missing: interval, storage Id, sourceId, sourceType, sourceConfig',
			});
		});

		it('should successfully create a plan', async () => {
			const planPayload = {
				settings: { interval: 'daily' },
				storage: { id: 'storage-1' },
				sourceType: 'local',
				sourceConfig: {},
			};
			const createdPlan = { id: 'plan-1', ...planPayload };
			mockRequest.body = planPayload;
			mockPlanService.createPlan.mockResolvedValue(createdPlan as any);

			await planController.createPlan(mockRequest as Request, mockResponse as Response);

			expect(mockPlanService.createPlan).toHaveBeenCalledWith(planPayload);
			expect(mockStatus).toHaveBeenCalledWith(201);
			expect(mockJson).toHaveBeenCalledWith({
				success: true,
				result: createdPlan,
			});
		});

		it('should return 500 if service throws an error', async () => {
			const planPayload = {
				settings: { interval: 'daily' },
				storage: { id: 'storage-1' },
				sourceType: 'local',
				sourceConfig: {},
			};
			mockRequest.body = planPayload;
			const error = new AppError(500, 'Creation failed');
			mockPlanService.createPlan.mockRejectedValue(error);

			await planController.createPlan(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(500);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Creation failed',
			});
		});
	});

	describe('updatePlan', () => {
		it('should return 400 if plan ID is missing', async () => {
			mockRequest.params = {};
			mockRequest.body = { plan: {} };

			await planController.updatePlan(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(400);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Plan ID is required.',
			});
		});

		it('should return 400 if payload is missing', async () => {
			mockRequest.params = { id: 'plan-1' };
			mockRequest.body = {};

			await planController.updatePlan(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(400);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Payload Missing.',
			});
		});

		it('should successfully update a plan', async () => {
			const planPayload = { name: 'Updated Plan' };
			const updatedPlan = { id: 'plan-1', ...planPayload };
			mockRequest.params = { id: 'plan-1' };
			mockRequest.body = { plan: planPayload };
			mockPlanService.updatePlan.mockResolvedValue(updatedPlan as any);

			await planController.updatePlan(mockRequest as Request, mockResponse as Response);

			expect(mockPlanService.updatePlan).toHaveBeenCalledWith('plan-1', planPayload);
			expect(mockStatus).toHaveBeenCalledWith(200);
			expect(mockJson).toHaveBeenCalledWith({
				success: true,
				result: updatedPlan,
			});
		});
	});

	describe('deletePlan', () => {
		it('should return 400 if plan ID is missing', async () => {
			mockRequest.params = {};

			await planController.deletePlan(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(400);
		});

		it('should successfully delete a plan', async () => {
			mockRequest.params = { id: 'plan-1' };
			mockPlanService.deletePlan.mockResolvedValue(true);

			await planController.deletePlan(mockRequest as Request, mockResponse as Response);

			expect(mockPlanService.deletePlan).toHaveBeenCalledWith('plan-1', false);
			expect(mockStatus).toHaveBeenCalledWith(200);
			expect(mockJson).toHaveBeenCalledWith({
				success: true,
				message: 'Plan deleted successfully',
			});
		});
	});

	describe('performBackup', () => {
		it('should return 400 if plan ID is missing', async () => {
			mockRequest.params = {};

			await planController.performBackup(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(400);
		});

		it('should successfully initiate backup', async () => {
			mockRequest.params = { id: 'plan-1' };
			mockPlanService.performBackup.mockResolvedValue(undefined);

			await planController.performBackup(mockRequest as Request, mockResponse as Response);

			expect(mockPlanService.performBackup).toHaveBeenCalledWith('plan-1');
			expect(mockStatus).toHaveBeenCalledWith(200);
			expect(mockJson).toHaveBeenCalledWith({
				success: true,
				message: 'Backup initiated successfully',
			});
		});
	});

	describe('pauseBackup', () => {
		it('should successfully pause backup', async () => {
			mockRequest.params = { id: 'plan-1' };
			mockPlanService.pauseBackup.mockResolvedValue(undefined);

			await planController.pauseBackup(mockRequest as Request, mockResponse as Response);

			expect(mockPlanService.pauseBackup).toHaveBeenCalledWith('plan-1');
			expect(mockStatus).toHaveBeenCalledWith(200);
		});
	});

	describe('resumeBackup', () => {
		it('should successfully resume backup', async () => {
			mockRequest.params = { id: 'plan-1' };
			mockPlanService.resumeBackup.mockResolvedValue(undefined);

			await planController.resumeBackup(mockRequest as Request, mockResponse as Response);

			expect(mockPlanService.resumeBackup).toHaveBeenCalledWith('plan-1');
			expect(mockStatus).toHaveBeenCalledWith(200);
		});
	});

	describe('pruneBackup', () => {
		it('should successfully prune backups', async () => {
			mockRequest.params = { id: 'plan-1' };
			mockPlanService.pruneBackups.mockResolvedValue('Pruned successfully');

			await planController.pruneBackup(mockRequest as Request, mockResponse as Response);

			expect(mockPlanService.pruneBackups).toHaveBeenCalledWith('plan-1');
			expect(mockStatus).toHaveBeenCalledWith(200);
		});
	});

	describe('unlockRepo', () => {
		it('should successfully unlock repository', async () => {
			mockRequest.params = { id: 'plan-1' };
			mockPlanService.unlockRepo.mockResolvedValue({ success: true, result: 'Unlocked' });

			await planController.unlockRepo(mockRequest as Request, mockResponse as Response);

			expect(mockPlanService.unlockRepo).toHaveBeenCalledWith('plan-1');
			expect(mockStatus).toHaveBeenCalledWith(200);
		});

		it('should return 500 if unlock fails', async () => {
			mockRequest.params = { id: 'plan-1' };
			mockPlanService.unlockRepo.mockResolvedValue({ success: false, result: 'Failed' });

			await planController.unlockRepo(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(500);
		});
	});

	describe('getLogs', () => {
		it('should return 400 if plan ID is missing', async () => {
			mockRequest.params = {};

			await planController.getLogs(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(400);
		});

		it('should successfully get logs', async () => {
			const mockLogs = [
				{ timestamp: new Date(), level: 'info', message: 'log line 1' },
				{ timestamp: new Date(), level: 'info', message: 'log line 2' },
			];
			mockRequest.params = { id: 'plan-1' };
			mockPlanService.getPlanLogs.mockResolvedValue(mockLogs as any);

			await planController.getLogs(mockRequest as Request, mockResponse as Response);

			expect(mockPlanService.getPlanLogs).toHaveBeenCalledWith('plan-1');
			expect(mockStatus).toHaveBeenCalledWith(200);
			expect(mockJson).toHaveBeenCalledWith({
				success: true,
				logs: mockLogs,
			});
		});
	});

	describe('downloadLogs', () => {
		it('should return 400 if plan ID is missing', async () => {
			mockRequest.params = {};

			await planController.downloadLogs(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(400);
		});

		it('should successfully stream log file', async () => {
			const mockFileStream = { pipe: mockPipe };
			mockRequest.params = { id: 'plan-1' };
			mockPlanService.downloadPlanLogs.mockResolvedValue(mockFileStream as any);

			await planController.downloadLogs(mockRequest as Request, mockResponse as Response);

			expect(mockPlanService.downloadPlanLogs).toHaveBeenCalledWith('plan-1');
			expect(mockSetHeader).toHaveBeenCalledWith('Content-Type', 'text/plain');
			expect(mockSetHeader).toHaveBeenCalledWith(
				'Content-Disposition',
				'attachment; filename="plan.log"'
			);
			expect(mockPipe).toHaveBeenCalledWith(mockResponse);
		});
	});
});
