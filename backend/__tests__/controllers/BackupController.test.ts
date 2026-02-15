import { Request, Response } from 'express';
import { BackupController } from '../../src/controllers/BackupController';
import { BackupService } from '../../src/services/BackupServices';

jest.mock('../../src/services/BackupServices');

describe('BackupController', () => {
	let backupController: BackupController;
	let mockBackupService: jest.Mocked<BackupService>;
	let mockRequest: Partial<Request>;
	let mockResponse: Partial<Response>;
	let mockJson: jest.Mock;
	let mockStatus: jest.Mock;
	let mockSetHeader: jest.Mock;
	let mockPipe: jest.Mock;

	beforeEach(() => {
		jest.clearAllMocks();

		mockBackupService = new BackupService(
			null as any,
			null as any,
			null as any,
			null as any,
			null as any,
			null as any
		) as jest.Mocked<BackupService>;

		mockJson = jest.fn().mockReturnThis();
		mockStatus = jest.fn().mockReturnValue({ json: mockJson });
		mockSetHeader = jest.fn();
		mockPipe = jest.fn();

		mockResponse = {
			json: mockJson,
			status: mockStatus,
			setHeader: mockSetHeader,
		};

		mockRequest = {
			params: {},
			query: {},
		};

		backupController = new BackupController(mockBackupService);
	});

	describe('getBackupDownload', () => {
		it('should return 400 if backup ID is missing', async () => {
			mockRequest.params = {};

			await backupController.getBackupDownload(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(400);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Backup ID is required',
			});
		});

		it('should successfully stream backup download', async () => {
			const mockFileStream = { pipe: mockPipe };
			mockRequest.params = { id: 'backup-123' };
			mockBackupService.getBackupDownload.mockResolvedValue({
				fileName: 'backup.tar',
				fileStream: mockFileStream as any,
			});

			await backupController.getBackupDownload(mockRequest as Request, mockResponse as Response);

			expect(mockBackupService.getBackupDownload).toHaveBeenCalledWith('backup-123');
			expect(mockSetHeader).toHaveBeenCalledWith('Content-Type', 'application/x-tar');
			expect(mockSetHeader).toHaveBeenCalledWith(
				'Content-Disposition',
				'attachment; filename=backup.tar'
			);
			expect(mockSetHeader).toHaveBeenCalledWith('Transfer-Encoding', 'chunked');
			expect(mockPipe).toHaveBeenCalledWith(mockResponse);
		});

		it('should return 500 if service throws an error', async () => {
			mockRequest.params = { id: 'backup-123' };
			mockBackupService.getBackupDownload.mockRejectedValue(new Error('Download failed'));

			await backupController.getBackupDownload(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(500);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Failed to get Downloaded file. Download failed',
			});
		});
	});

	describe('generateBackupDownload', () => {
		it('should return 400 if backup ID is missing', async () => {
			mockRequest.params = {};

			await backupController.generateBackupDownload(
				mockRequest as Request,
				mockResponse as Response
			);

			expect(mockStatus).toHaveBeenCalledWith(400);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Backup ID is required',
			});
		});

		it('should successfully generate backup download', async () => {
			mockRequest.params = { id: 'backup-123' };
			mockBackupService.generateBackupDownload.mockResolvedValue('Download link generated');

			await backupController.generateBackupDownload(
				mockRequest as Request,
				mockResponse as Response
			);

			expect(mockBackupService.generateBackupDownload).toHaveBeenCalledWith('backup-123');
			expect(mockStatus).toHaveBeenCalledWith(200);
			expect(mockJson).toHaveBeenCalledWith({
				success: true,
				result: 'Download link generated',
			});
		});

		it('should return 500 if service throws an error', async () => {
			mockRequest.params = { id: 'backup-123' };
			mockBackupService.generateBackupDownload.mockRejectedValue(new Error('Generation failed'));

			await backupController.generateBackupDownload(
				mockRequest as Request,
				mockResponse as Response
			);

			expect(mockStatus).toHaveBeenCalledWith(500);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Failed to generate Download Link. Generation failed',
			});
		});
	});

	describe('getSnapshotFiles', () => {
		it('should return 400 if backup ID is missing', async () => {
			mockRequest.params = {};

			await backupController.getSnapshotFiles(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(400);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Backup ID is required',
			});
		});

		it('should successfully get snapshot files', async () => {
			const mockFiles = [{ name: 'file1.txt', path: '/path/file1.txt' }];
			mockRequest.params = { id: 'backup-123' };
			mockBackupService.getSnapshotFiles.mockResolvedValue(mockFiles as any);

			await backupController.getSnapshotFiles(mockRequest as Request, mockResponse as Response);

			expect(mockBackupService.getSnapshotFiles).toHaveBeenCalledWith('backup-123');
			expect(mockStatus).toHaveBeenCalledWith(200);
			expect(mockJson).toHaveBeenCalledWith({
				success: true,
				result: mockFiles,
			});
		});

		it('should return 500 if service throws an error', async () => {
			mockRequest.params = { id: 'backup-123' };
			mockBackupService.getSnapshotFiles.mockRejectedValue(new Error('Failed to get files'));

			await backupController.getSnapshotFiles(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(500);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Failed to get Snapshot Files. Failed to get files',
			});
		});
	});

	describe('cancelBackupDownload', () => {
		it('should return 400 if backup ID is missing', async () => {
			mockRequest.params = {};

			await backupController.cancelBackupDownload(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(400);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Backup ID is required',
			});
		});

		it('should successfully cancel backup download', async () => {
			mockRequest.params = { id: 'backup-123' };
			mockRequest.query = { planId: 'plan-456' };
			mockBackupService.cancelBackupDownload.mockResolvedValue('Download cancelled');

			await backupController.cancelBackupDownload(mockRequest as Request, mockResponse as Response);

			expect(mockBackupService.cancelBackupDownload).toHaveBeenCalledWith('plan-456', 'backup-123');
			expect(mockStatus).toHaveBeenCalledWith(200);
			expect(mockJson).toHaveBeenCalledWith({
				success: true,
				result: 'Download cancelled',
			});
		});

		it('should return 500 if service throws an error', async () => {
			mockRequest.params = { id: 'backup-123' };
			mockRequest.query = { planId: 'plan-456' };
			mockBackupService.cancelBackupDownload.mockRejectedValue(new Error('Cancel failed'));

			await backupController.cancelBackupDownload(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(500);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Failed to cancel Download Generation. Cancel failed',
			});
		});
	});

	describe('deleteBackup', () => {
		it('should return 400 if backup ID is missing', async () => {
			mockRequest.params = {};

			await backupController.deleteBackup(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(400);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Backup ID is required',
			});
		});

		it('should successfully delete backup', async () => {
			mockRequest.params = { id: 'backup-123' };
			mockBackupService.deleteBackup.mockResolvedValue({} as any);

			await backupController.deleteBackup(mockRequest as Request, mockResponse as Response);

			expect(mockBackupService.deleteBackup).toHaveBeenCalledWith('backup-123', true);
			expect(mockStatus).toHaveBeenCalledWith(200);
			expect(mockJson).toHaveBeenCalledWith({
				success: true,
				result: 'Removed',
			});
		});

		it('should return 500 if service throws an error', async () => {
			mockRequest.params = { id: 'backup-123' };
			mockBackupService.deleteBackup.mockRejectedValue(new Error('Delete failed'));

			await backupController.deleteBackup(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(500);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Delete failed',
			});
		});
	});

	describe('getBackupProgress', () => {
		it('should return 400 if required parameters are missing', async () => {
			mockRequest.params = { id: 'backup-123' };
			mockRequest.query = {};

			await backupController.getBackupProgress(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(400);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Backup ID or Device ID is required',
			});
		});

		it('should successfully get backup progress', async () => {
			const mockProgress = { percent_done: 50, bytes_done: 1024 };
			mockRequest.params = { id: 'backup-123' };
			mockRequest.query = { sourceId: 'device-456', sourceType: 'local' };
			mockBackupService.getBackupProgress.mockResolvedValue(mockProgress);

			await backupController.getBackupProgress(mockRequest as Request, mockResponse as Response);

			expect(mockBackupService.getBackupProgress).toHaveBeenCalledWith('backup-123');
			expect(mockStatus).toHaveBeenCalledWith(200);
			expect(mockJson).toHaveBeenCalledWith(mockProgress);
		});

		it('should return 500 if service throws an error', async () => {
			mockRequest.params = { id: 'backup-123' };
			mockRequest.query = { sourceId: 'device-456', sourceType: 'local' };
			mockBackupService.getBackupProgress.mockRejectedValue(new Error('Progress failed'));

			await backupController.getBackupProgress(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(500);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Progress failed',
			});
		});
	});

	describe('cancelBackup', () => {
		it('should return 400 if backup ID or planId is missing', async () => {
			mockRequest.params = { id: 'backup-123' };
			mockRequest.query = {};

			await backupController.cancelBackup(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(400);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Backup ID is required',
			});
		});

		it('should successfully cancel backup', async () => {
			const mockResult = { success: true, result: 'Cancelled' };
			mockRequest.params = { id: 'backup-123' };
			mockRequest.query = { planId: 'plan-456' };
			mockBackupService.cancelBackup.mockResolvedValue(mockResult);

			await backupController.cancelBackup(mockRequest as Request, mockResponse as Response);

			expect(mockBackupService.cancelBackup).toHaveBeenCalledWith('plan-456', 'backup-123');
			expect(mockStatus).toHaveBeenCalledWith(200);
			expect(mockJson).toHaveBeenCalledWith(mockResult);
		});

		it('should return 500 if service throws an error', async () => {
			mockRequest.params = { id: 'backup-123' };
			mockRequest.query = { planId: 'plan-456' };
			mockBackupService.cancelBackup.mockRejectedValue(new Error('Cancel failed'));

			await backupController.cancelBackup(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(500);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Cancel failed',
			});
		});
	});
});
