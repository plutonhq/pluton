import { Request, Response } from 'express';
import { SetupController } from '../../src/controllers/SetupController';

jest.mock('../../src/utils/envFileHelpers', () => ({
	writeEncryptionKeyToEnvFile: jest.fn(),
	encEnvFileExists: jest.fn(),
}));

jest.mock('../../src/services/ConfigService', () => ({
	configService: {
		isSetupPending: jest.fn(),
		completeSetup: jest.fn(),
		markSetupPending: jest.fn(),
	},
}));

jest.mock('../../src/utils/installHelpers', () => ({
	requiresDesktopSetup: jest.fn(),
	isBinaryMode: jest.fn(),
}));

jest.mock('../../src/utils/initSetup', () => ({
	initSetup: jest.fn(),
}));

jest.mock('../../src/db', () => ({
	db: {},
}));

jest.mock('../../src/utils/AppPaths', () => ({
	appPaths: {
		getDataDir: jest.fn().mockReturnValue('/mock/data'),
		getEncEnvFilePath: jest.fn().mockReturnValue('/mock/config/pluton.enc.env'),
	},
}));

jest.mock('fs', () => ({
	...jest.requireActual('fs'),
	accessSync: jest.fn(),
	constants: { W_OK: 2 },
}));

import { configService } from '../../src/services/ConfigService';
import { requiresDesktopSetup, isBinaryMode } from '../../src/utils/installHelpers';
import { writeEncryptionKeyToEnvFile, encEnvFileExists } from '../../src/utils/envFileHelpers';
import { initSetup } from '../../src/utils/initSetup';
import fs from 'fs';

describe('SetupController', () => {
	let controller: SetupController;
	let mockRequest: Partial<Request>;
	let mockResponse: Partial<Response>;
	let mockJson: jest.Mock;
	let mockStatus: jest.Mock;

	beforeEach(() => {
		jest.clearAllMocks();

		mockJson = jest.fn().mockReturnThis();
		mockStatus = jest.fn().mockReturnValue({ json: mockJson });

		mockResponse = {
			json: mockJson,
			status: mockStatus,
		};

		mockRequest = {
			body: {},
		};

		controller = new SetupController();
	});

	describe('getStatus', () => {
		it('should return setup status successfully', async () => {
			(configService.isSetupPending as jest.Mock).mockReturnValue(true);
			(isBinaryMode as jest.Mock).mockReturnValue(false);
			(requiresDesktopSetup as jest.Mock).mockReturnValue(true);
			(encEnvFileExists as jest.Mock).mockReturnValue(false);

			await controller.getStatus(mockRequest as Request, mockResponse as Response);

			expect(mockJson).toHaveBeenCalledWith({
				success: true,
				data: {
					setupPending: true,
					isBinary: false,
					requiresSetup: true,
					requiresKeyringSetup: true,
					hasEncEnvFile: false,
					platform: process.platform,
				},
			});
		});

		it('should return 500 on error', async () => {
			(configService.isSetupPending as jest.Mock).mockImplementation(() => {
				throw new Error('Status check failed');
			});

			await controller.getStatus(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(500);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Status check failed',
			});
		});
	});

	describe('completeSetup', () => {
		const validBody = {
			encryptionKey: 'mySecureKey123',
			userName: 'admin',
			userPassword: 'password123',
		};

		it('should return 400 if setup is not pending', async () => {
			(configService.isSetupPending as jest.Mock).mockReturnValue(false);

			await controller.completeSetup(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(400);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Setup is not pending. Application is already configured.',
			});
		});

		it('should return 400 if desktop setup is not supported', async () => {
			(configService.isSetupPending as jest.Mock).mockReturnValue(true);
			(requiresDesktopSetup as jest.Mock).mockReturnValue(false);

			await controller.completeSetup(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(400);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error:
					'Desktop setup is only available on Windows, macOS and Linux desktop binary installations.',
			});
		});

		it('should return 400 if required fields are missing', async () => {
			(configService.isSetupPending as jest.Mock).mockReturnValue(true);
			(requiresDesktopSetup as jest.Mock).mockReturnValue(true);
			mockRequest.body = { encryptionKey: 'mySecureKey123' };

			await controller.completeSetup(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(400);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Missing required fields: encryptionKey, userName, userPassword',
			});
		});

		it('should return 400 if encryptionKey is too short', async () => {
			(configService.isSetupPending as jest.Mock).mockReturnValue(true);
			(requiresDesktopSetup as jest.Mock).mockReturnValue(true);
			mockRequest.body = { encryptionKey: 'short', userName: 'admin', userPassword: 'password123' };

			await controller.completeSetup(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(400);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Encryption key must be at least 12 characters long',
			});
		});

		it('should return 400 if userName is empty', async () => {
			(configService.isSetupPending as jest.Mock).mockReturnValue(true);
			(requiresDesktopSetup as jest.Mock).mockReturnValue(true);
			mockRequest.body = {
				encryptionKey: 'mySecureKey123',
				userName: '',
				userPassword: 'password123',
			};

			await controller.completeSetup(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(400);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Missing required fields: encryptionKey, userName, userPassword',
			});
		});

		it('should return 400 if userPassword is empty', async () => {
			(configService.isSetupPending as jest.Mock).mockReturnValue(true);
			(requiresDesktopSetup as jest.Mock).mockReturnValue(true);
			mockRequest.body = { encryptionKey: 'mySecureKey123', userName: 'admin', userPassword: '' };

			await controller.completeSetup(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(400);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Missing required fields: encryptionKey, userName, userPassword',
			});
		});

		it('should complete setup successfully by writing to env file', async () => {
			(configService.isSetupPending as jest.Mock).mockReturnValue(true);
			(requiresDesktopSetup as jest.Mock).mockReturnValue(true);
			(initSetup as jest.Mock).mockResolvedValue(undefined);
			mockRequest.body = validBody;

			await controller.completeSetup(mockRequest as Request, mockResponse as Response);

			expect(writeEncryptionKeyToEnvFile).toHaveBeenCalledWith(
				'/mock/data',
				validBody.encryptionKey
			);
			expect(configService.completeSetup).toHaveBeenCalledWith({
				ENCRYPTION_KEY: validBody.encryptionKey,
				USER_NAME: validBody.userName,
				USER_PASSWORD: validBody.userPassword,
			});
			expect(initSetup).toHaveBeenCalled();
			expect(mockJson).toHaveBeenCalledWith({
				success: true,
				message: 'Setup completed successfully. Credentials stored securely.',
			});
		});

		it('should roll back setup pending state if initSetup fails', async () => {
			(configService.isSetupPending as jest.Mock).mockReturnValue(true);
			(requiresDesktopSetup as jest.Mock).mockReturnValue(true);
			(initSetup as jest.Mock).mockRejectedValue(new Error('DB migration failed'));
			mockRequest.body = validBody;

			await controller.completeSetup(mockRequest as Request, mockResponse as Response);

			expect(configService.completeSetup).toHaveBeenCalled();
			expect(configService.markSetupPending).toHaveBeenCalled();
			expect(mockStatus).toHaveBeenCalledWith(500);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'DB migration failed',
			});
		});

		it('should return 500 on unexpected error', async () => {
			(configService.isSetupPending as jest.Mock).mockImplementation(() => {
				throw new Error('Unexpected failure');
			});

			await controller.completeSetup(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(500);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Unexpected failure',
			});
		});
	});

	describe('checkKeyringAvailability', () => {
		it('should return system availability successfully', async () => {
			(requiresDesktopSetup as jest.Mock).mockReturnValue(true);
			(fs.accessSync as jest.Mock).mockReturnValue(undefined);

			await controller.checkKeyringAvailability(mockRequest as Request, mockResponse as Response);

			expect(mockJson).toHaveBeenCalledWith({
				success: true,
				data: {
					platformSupported: true,
					keyringAvailable: true,
					dataDirWritable: true,
					platform: process.platform,
				},
			});
		});

		it('should return false when data dir is not writable', async () => {
			(requiresDesktopSetup as jest.Mock).mockReturnValue(true);
			(fs.accessSync as jest.Mock).mockImplementation(() => {
				throw new Error('EACCES');
			});

			await controller.checkKeyringAvailability(mockRequest as Request, mockResponse as Response);

			expect(mockJson).toHaveBeenCalledWith({
				success: true,
				data: {
					platformSupported: true,
					keyringAvailable: false,
					dataDirWritable: false,
					platform: process.platform,
				},
			});
		});

		it('should return 500 on error', async () => {
			(requiresDesktopSetup as jest.Mock).mockImplementation(() => {
				throw new Error('Check failed');
			});

			await controller.checkKeyringAvailability(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(500);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Check failed',
			});
		});
	});
});
