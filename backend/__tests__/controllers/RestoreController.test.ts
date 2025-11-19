import { Request, Response } from 'express';
import { RestoreController } from '../../src/controllers/RestoreController';
import { RestoreService } from '../../src/services/RestoreService';

jest.mock('../../src/services/RestoreService');

describe('RestoreController', () => {
	let restoreController: RestoreController;
	let mockRestoreService: jest.Mocked<RestoreService>;
	let mockRequest: Partial<Request>;
	let mockResponse: Partial<Response>;
	let mockJson: jest.Mock;
	let mockStatus: jest.Mock;

	beforeEach(() => {
		jest.clearAllMocks();

		mockRestoreService = new RestoreService(
			null as any,
			null as any,
			null as any,
			null as any,
			null as any,
			null as any
		) as jest.Mocked<RestoreService>;

		mockJson = jest.fn().mockReturnThis();
		mockStatus = jest.fn().mockReturnValue({ json: mockJson });

		mockResponse = {
			json: mockJson,
			status: mockStatus,
		};

		mockRequest = {
			params: {},
			query: {},
			body: {},
		};

		restoreController = new RestoreController(mockRestoreService);
	});

	describe('listRestores', () => {
		it('should successfully get all restores', async () => {
			const mockRestores = [
				{ id: 'restore-1', backupId: 'backup-1' },
				{ id: 'restore-2', backupId: 'backup-2' },
			];
			mockRestoreService.getAllRestores.mockResolvedValue(mockRestores as any);

			await restoreController.listRestores(mockRequest as Request, mockResponse as Response);

			expect(mockRestoreService.getAllRestores).toHaveBeenCalled();
			expect(mockJson).toHaveBeenCalledWith({
				success: true,
				result: mockRestores,
			});
		});

		it('should return 500 if service throws an error', async () => {
			mockRestoreService.getAllRestores.mockRejectedValue(new Error('Database error'));

			await restoreController.listRestores(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(500);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Failed to fetch restores',
			});
		});
	});

	describe('getRestore', () => {
		it('should return 400 if restore ID is missing', async () => {
			mockRequest.params = {};

			await restoreController.getRestore(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(400);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Restore ID is required',
			});
		});

		it('should successfully get a restore', async () => {
			const mockRestore = { id: 'restore-1', backupId: 'backup-1' };
			mockRequest.params = { id: 'restore-1' };
			mockRestoreService.getRestore.mockResolvedValue(mockRestore as any);

			await restoreController.getRestore(mockRequest as Request, mockResponse as Response);

			expect(mockRestoreService.getRestore).toHaveBeenCalledWith('restore-1');
			expect(mockJson).toHaveBeenCalledWith({
				success: true,
				result: mockRestore,
			});
		});

		it('should return 404 if restore not found', async () => {
			mockRequest.params = { id: 'restore-1' };
			mockRestoreService.getRestore.mockResolvedValue(undefined as any);

			await restoreController.getRestore(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(404);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Restore not found',
			});
		});

		it('should return 500 if service throws an error', async () => {
			mockRequest.params = { id: 'restore-1' };
			mockRestoreService.getRestore.mockRejectedValue(new Error('Database error'));

			await restoreController.getRestore(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(500);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Failed to fetch restore',
			});
		});
	});

	describe('getRestoreStats', () => {
		it('should return 400 if restore ID is missing', async () => {
			mockRequest.params = {};

			await restoreController.getRestoreStats(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(400);
		});

		it('should successfully get restore stats', async () => {
			const mockStats = { files_restored: 100, bytes_restored: 1024 };
			mockRequest.params = { id: 'restore-1' };
			mockRestoreService.getRestoreStats.mockResolvedValue({
				success: true,
				result: mockStats,
			});

			await restoreController.getRestoreStats(mockRequest as Request, mockResponse as Response);

			expect(mockRestoreService.getRestoreStats).toHaveBeenCalledWith('restore-1');
			expect(mockJson).toHaveBeenCalledWith({
				success: true,
				result: mockStats,
			});
		});

		it('should return 404 if stats not found', async () => {
			mockRequest.params = { id: 'restore-1' };
			mockRestoreService.getRestoreStats.mockResolvedValue({
				success: false,
				result: 'Stats not found',
			});

			await restoreController.getRestoreStats(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(404);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Stats not found',
			});
		});

		it('should return 500 if service throws an error', async () => {
			mockRequest.params = { id: 'restore-1' };
			mockRestoreService.getRestoreStats.mockRejectedValue(new Error('Read error'));

			await restoreController.getRestoreStats(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(500);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Failed to fetch restore stats',
			});
		});
	});

	describe('deleteRestore', () => {
		it('should return 400 if restore ID is missing', async () => {
			mockRequest.params = {};

			await restoreController.deleteRestore(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(400);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Restore ID is required',
			});
		});

		it('should successfully delete restore', async () => {
			mockRequest.params = { id: 'restore-1' };
			mockRestoreService.deleteRestore.mockResolvedValue(undefined);

			await restoreController.deleteRestore(mockRequest as Request, mockResponse as Response);

			expect(mockRestoreService.deleteRestore).toHaveBeenCalledWith('restore-1');
			expect(mockJson).toHaveBeenCalledWith({ success: true });
		});

		it('should return 500 if service throws an error', async () => {
			mockRequest.params = { id: 'restore-1' };
			mockRestoreService.deleteRestore.mockRejectedValue(new Error('Delete failed'));

			await restoreController.deleteRestore(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(500);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Failed to delete restore',
			});
		});
	});

	describe('performDryRestore', () => {
		it('should return 400 if required fields are missing', async () => {
			mockRequest.body = {};

			await restoreController.performDryRestore(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(400);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Required fields missing: backupId, planId',
			});
		});

		it('should successfully perform dry restore', async () => {
			const restorePayload = {
				backupId: 'backup-1',
				planId: 'plan-1',
				target: '/restore/path',
				overwrite: 'always' as const,
				includes: ['file1.txt'],
				excludes: ['*.tmp'],
				delete: false,
			};
			const mockResult = { files: 100, size: 1024 };
			mockRequest.body = restorePayload;
			mockRestoreService.dryRestoreBackup.mockResolvedValue(mockResult as any);

			await restoreController.performDryRestore(mockRequest as Request, mockResponse as Response);

			expect(mockRestoreService.dryRestoreBackup).toHaveBeenCalledWith('backup-1', {
				target: '/restore/path',
				overwrite: 'always',
				includes: ['file1.txt'],
				excludes: ['*.tmp'],
				delete: false,
			});
			expect(mockStatus).toHaveBeenCalledWith(200);
			expect(mockJson).toHaveBeenCalledWith({
				success: true,
				result: mockResult,
			});
		});

		it('should handle default values for optional fields', async () => {
			const restorePayload = {
				backupId: 'backup-1',
				planId: 'plan-1',
				target: '/restore/path',
			};
			mockRequest.body = restorePayload;
			mockRestoreService.dryRestoreBackup.mockResolvedValue({} as any);

			await restoreController.performDryRestore(mockRequest as Request, mockResponse as Response);

			expect(mockRestoreService.dryRestoreBackup).toHaveBeenCalledWith('backup-1', {
				target: '/restore/path',
				overwrite: undefined,
				includes: [],
				excludes: [],
				delete: false,
			});
		});

		it('should return 500 if service throws an error', async () => {
			const restorePayload = {
				backupId: 'backup-1',
				planId: 'plan-1',
				target: '/restore/path',
			};
			mockRequest.body = restorePayload;
			mockRestoreService.dryRestoreBackup.mockRejectedValue(new Error('Restore failed'));

			await restoreController.performDryRestore(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(500);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Failed to restore plan',
			});
		});
	});

	describe('performRestore', () => {
		it('should return 400 if required fields are missing', async () => {
			mockRequest.body = { backupId: 'backup-1' };

			await restoreController.performRestore(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(400);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Required fields missing: Backup or Plan Id.',
			});
		});

		it('should successfully perform restore', async () => {
			const restorePayload = {
				backupId: 'backup-1',
				planId: 'plan-1',
				target: '/restore/path',
				overwrite: 'if-newer' as const,
			};
			const mockResult = { id: 'restore-1', status: 'in-progress' };
			mockRequest.body = restorePayload;
			mockRestoreService.restoreBackup.mockResolvedValue(mockResult as any);

			await restoreController.performRestore(mockRequest as Request, mockResponse as Response);

			expect(mockRestoreService.restoreBackup).toHaveBeenCalledWith('backup-1', {
				target: '/restore/path',
				overwrite: 'if-newer',
				includes: [],
				excludes: [],
				delete: false,
			});
			expect(mockStatus).toHaveBeenCalledWith(200);
			expect(mockJson).toHaveBeenCalledWith({
				success: true,
				result: mockResult,
			});
		});

		it('should return 500 if service throws an error', async () => {
			const restorePayload = {
				backupId: 'backup-1',
				planId: 'plan-1',
				target: '/restore/path',
			};
			mockRequest.body = restorePayload;
			mockRestoreService.restoreBackup.mockRejectedValue(new Error('Restore failed'));

			await restoreController.performRestore(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(500);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Failed to restore backup',
			});
		});
	});

	describe('getRestoreProgress', () => {
		it('should return 400 if required parameters are missing', async () => {
			mockRequest.params = { id: 'restore-1' };
			mockRequest.query = { sourceId: 'device-1' };

			await restoreController.getRestoreProgress(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(400);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Backup, Device or Plan ID is missing',
			});
		});

		it('should successfully get restore progress', async () => {
			const mockProgress = { percent_done: 75, files_restored: 50 };
			mockRequest.params = { id: 'restore-1' };
			mockRequest.query = {
				sourceId: 'device-1',
				sourceType: 'local',
				planId: 'plan-1',
			};
			mockRestoreService.getRestoreProgress.mockResolvedValue(mockProgress);

			await restoreController.getRestoreProgress(mockRequest as Request, mockResponse as Response);

			expect(mockRestoreService.getRestoreProgress).toHaveBeenCalledWith('restore-1');
			expect(mockStatus).toHaveBeenCalledWith(200);
			expect(mockJson).toHaveBeenCalledWith(mockProgress);
		});

		it('should return 500 if service throws an error', async () => {
			mockRequest.params = { id: 'restore-1' };
			mockRequest.query = {
				sourceId: 'device-1',
				sourceType: 'local',
				planId: 'plan-1',
			};
			mockRestoreService.getRestoreProgress.mockRejectedValue(new Error('Progress failed'));

			await restoreController.getRestoreProgress(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(500);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Failed to retrieve Backup Progress',
			});
		});
	});

	describe('cancelRestore', () => {
		it('should return 400 if restore ID is missing', async () => {
			mockRequest.params = {};

			await restoreController.cancelRestore(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(400);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Backup ID or Restore ID is required',
			});
		});

		it('should successfully cancel restore', async () => {
			const mockResult = { success: true, result: 'Cancelled' };
			mockRequest.params = { id: 'restore-1' };
			mockRestoreService.cancelRestore.mockResolvedValue(mockResult);

			await restoreController.cancelRestore(mockRequest as Request, mockResponse as Response);

			expect(mockRestoreService.cancelRestore).toHaveBeenCalledWith('restore-1');
			expect(mockStatus).toHaveBeenCalledWith(200);
			expect(mockJson).toHaveBeenCalledWith(mockResult);
		});

		it('should return 500 if service throws an error', async () => {
			mockRequest.params = { id: 'restore-1' };
			mockRestoreService.cancelRestore.mockRejectedValue(new Error('Cancel failed'));

			await restoreController.cancelRestore(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(500);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Failed to cancel Download Generation. Cancel failed',
			});
		});
	});
});
