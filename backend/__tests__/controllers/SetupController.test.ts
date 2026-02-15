import { Request, Response } from 'express';
import { SetupController } from '../../src/controllers/SetupController';

jest.mock('../../src/services/KeyringService', () => ({
	keyringService: {
		isPlatformSupported: jest.fn(),
		waitForInitialization: jest.fn(),
		setAllCredentials: jest.fn(),
	},
}));

jest.mock('../../src/services/ConfigService', () => ({
	configService: {
		isSetupPending: jest.fn(),
		completeSetup: jest.fn(),
	},
}));

jest.mock('../../src/utils/installHelpers', () => ({
	requiresKeyringSetup: jest.fn(),
	isBinaryMode: jest.fn(),
}));

jest.mock('../../src/utils/initSetup', () => ({
	initSetup: jest.fn(),
}));

jest.mock('../../src/db', () => ({
	db: {},
}));

import { keyringService } from '../../src/services/KeyringService';
import { configService } from '../../src/services/ConfigService';
import { requiresKeyringSetup, isBinaryMode } from '../../src/utils/installHelpers';
import { initSetup } from '../../src/utils/initSetup';

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
			(requiresKeyringSetup as jest.Mock).mockReturnValue(true);

			await controller.getStatus(mockRequest as Request, mockResponse as Response);

			expect(mockJson).toHaveBeenCalledWith({
				success: true,
				data: {
					setupPending: true,
					isBinary: false,
					requiresKeyringSetup: true,
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

		it('should return 400 if keyring setup is not supported', async () => {
			(configService.isSetupPending as jest.Mock).mockReturnValue(true);
			(requiresKeyringSetup as jest.Mock).mockReturnValue(false);

			await controller.completeSetup(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(400);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Keyring setup is only available on Windows and macOS binary installations.',
			});
		});

		it('should return 400 if required fields are missing', async () => {
			(configService.isSetupPending as jest.Mock).mockReturnValue(true);
			(requiresKeyringSetup as jest.Mock).mockReturnValue(true);
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
			(requiresKeyringSetup as jest.Mock).mockReturnValue(true);
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
			(requiresKeyringSetup as jest.Mock).mockReturnValue(true);
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
			(requiresKeyringSetup as jest.Mock).mockReturnValue(true);
			mockRequest.body = { encryptionKey: 'mySecureKey123', userName: 'admin', userPassword: '' };

			await controller.completeSetup(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(400);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Missing required fields: encryptionKey, userName, userPassword',
			});
		});

		it('should return 500 if keyring store fails', async () => {
			(configService.isSetupPending as jest.Mock).mockReturnValue(true);
			(requiresKeyringSetup as jest.Mock).mockReturnValue(true);
			(keyringService.setAllCredentials as jest.Mock).mockResolvedValue(false);
			mockRequest.body = validBody;

			await controller.completeSetup(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(500);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Failed to store credentials in the system keyring',
			});
		});

		it('should complete setup successfully', async () => {
			(configService.isSetupPending as jest.Mock).mockReturnValue(true);
			(requiresKeyringSetup as jest.Mock).mockReturnValue(true);
			(keyringService.setAllCredentials as jest.Mock).mockResolvedValue(true);
			(initSetup as jest.Mock).mockResolvedValue(undefined);
			mockRequest.body = validBody;

			await controller.completeSetup(mockRequest as Request, mockResponse as Response);

			expect(keyringService.setAllCredentials).toHaveBeenCalledWith({
				ENCRYPTION_KEY: validBody.encryptionKey,
				USER_NAME: validBody.userName,
				USER_PASSWORD: validBody.userPassword,
			});
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
		it('should return keyring availability successfully', async () => {
			(keyringService.isPlatformSupported as jest.Mock).mockReturnValue(true);
			(keyringService.waitForInitialization as jest.Mock).mockResolvedValue(true);

			await controller.checkKeyringAvailability(mockRequest as Request, mockResponse as Response);

			expect(mockJson).toHaveBeenCalledWith({
				success: true,
				data: {
					platformSupported: true,
					keyringAvailable: true,
					platform: process.platform,
				},
			});
		});

		it('should return 500 on error', async () => {
			(keyringService.isPlatformSupported as jest.Mock).mockImplementation(() => {
				throw new Error('Keyring check failed');
			});

			await controller.checkKeyringAvailability(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(500);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Keyring check failed',
			});
		});
	});
});
