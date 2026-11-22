import { Request, Response } from 'express';
import { UserController } from '../../src/controllers/UserController';
import { configService } from '../../src/services/ConfigService';
import jwt from 'jsonwebtoken';
import Cryptr from 'cryptr';
import * as otpauth from 'otpauth';

jest.mock('jsonwebtoken');

const mockLoggerWarn = jest.fn();
jest.mock('../../src/utils/logger', () => ({
	serverLogger: { warn: (...args: any[]) => mockLoggerWarn(...args) },
}));

const TOTP_SECRET = new otpauth.Secret().base32;
const totpSettings = (enabled = true) => ({
	id: 1,
	settings: {
		title: 'Pluton',
		totp: { enabled, secret: new Cryptr('test-secret').encrypt(TOTP_SECRET), recoveryCodes: [] },
	},
});
const currentTotpCode = () =>
	new otpauth.TOTP({ secret: otpauth.Secret.fromBase32(TOTP_SECRET) }).generate();

const mockVerifyPassword = jest.fn();
const mockHashAndStorePassword = jest.fn();

jest.mock('../../src/services/ConfigService', () => ({
	configService: {
		config: {
			USER_NAME: 'testuser',
			USER_PASSWORD: 'testpass',
			SECRET: 'test-secret',
			SESSION_DURATION: 7,
		},
		verifyPassword: (...args: any[]) => mockVerifyPassword(...args),
		hashAndStorePassword: (...args: any[]) => mockHashAndStorePassword(...args),
	},
}));

describe('UserController', () => {
	let userController: UserController;
	let mockRequest: Partial<Request>;
	let mockResponse: Partial<Response>;
	let mockJson: jest.Mock;
	let mockStatus: jest.Mock;
	let mockCookie: jest.Mock;
	let mockClearCookie: jest.Mock;
	let mockSettingsService: { getMainSettings: jest.Mock; consumeRecoveryCode: jest.Mock };
	let mockSession: Record<string, any>;

	beforeEach(() => {
		jest.clearAllMocks();
		mockVerifyPassword.mockReturnValue(false);
		mockHashAndStorePassword.mockReturnValue('$2a$10$mockhash');

		mockJson = jest.fn().mockReturnThis();
		mockStatus = jest.fn().mockReturnValue({ json: mockJson });
		mockCookie = jest.fn();
		mockClearCookie = jest.fn();

		mockResponse = {
			json: mockJson,
			status: mockStatus,
			cookie: mockCookie,
			clearCookie: mockClearCookie,
		};

		mockSession = {
			regenerate: jest.fn((cb: (err?: any) => void) => cb()),
			destroy: jest.fn((cb: (err?: any) => void) => cb()),
		};
		mockRequest = {
			body: {},
			session: mockSession as any,
		};

		mockSettingsService = {
			getMainSettings: jest.fn().mockResolvedValue({ id: 1, settings: {} }),
			consumeRecoveryCode: jest.fn().mockResolvedValue(false),
		};
		userController = new UserController(mockSettingsService as any);
	});

	describe('validateUser', () => {
		it('should return 200 success response', async () => {
			await userController.validateUser(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(200);
			expect(mockJson).toHaveBeenCalledWith({ success: true });
		});
	});

	describe('loginUser', () => {
		it('should return 401 if username is missing', async () => {
			mockRequest.body = { password: 'testpass' };

			await userController.loginUser(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(401);
			expect(mockJson).toHaveBeenCalledWith({ error: 'Username & Password Missing' });
		});

		it('should return 401 if password is missing', async () => {
			mockRequest.body = { username: 'testuser' };

			await userController.loginUser(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(401);
			expect(mockJson).toHaveBeenCalledWith({ error: 'Username & Password Missing' });
		});

		it('should return 401 if username is incorrect', async () => {
			mockRequest.body = { username: 'wronguser', password: 'testpass' };
			mockVerifyPassword.mockReturnValue(true);

			await userController.loginUser(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(401);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Incorrect Username or Password',
			});
		});

		it('should return 401 if password is incorrect', async () => {
			mockRequest.body = { username: 'testuser', password: 'wrongpass' };
			mockVerifyPassword.mockReturnValue(false);

			await userController.loginUser(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(401);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Incorrect Username or Password',
			});
		});

		it('should successfully login with correct credentials', async () => {
			mockRequest.body = { username: 'testuser', password: 'testpass' };
			mockVerifyPassword.mockReturnValue(true);
			(jwt.sign as jest.Mock).mockReturnValue('mock-token');

			await userController.loginUser(mockRequest as Request, mockResponse as Response);

			expect(jwt.sign).toHaveBeenCalledWith({ user: 'testuser' }, 'test-secret', {
				expiresIn: '7d',
			});
			expect(mockCookie).toHaveBeenCalledWith('token', 'mock-token', {
				httpOnly: true,
				sameSite: 'lax',
				maxAge: 7 * 24 * 60 * 60 * 1000,
				secure: undefined,
			});
			expect(mockStatus).toHaveBeenCalledWith(200);
			expect(mockJson).toHaveBeenCalledWith({ success: true, error: null });
		});

		it('should use default session duration if not configured', async () => {
			const originalDuration = configService.config.SESSION_DURATION;
			(configService.config as any).SESSION_DURATION = undefined;

			mockRequest.body = { username: 'testuser', password: 'testpass' };
			mockVerifyPassword.mockReturnValue(true);
			(jwt.sign as jest.Mock).mockReturnValue('mock-token');

			await userController.loginUser(mockRequest as Request, mockResponse as Response);

			expect(mockCookie).toHaveBeenCalledWith('token', 'mock-token', {
				httpOnly: true,
				sameSite: 'lax',
				maxAge: 7 * 24 * 60 * 60 * 1000,
				secure: undefined,
			});

			(configService.config as any).SESSION_DURATION = originalDuration;
		});
	});

	describe('loginUser with 2FA enabled', () => {
		it('should require the 2FA step and not set the token cookie', async () => {
			mockRequest.body = { username: 'testuser', password: 'testpass' };
			mockVerifyPassword.mockReturnValue(true);
			mockSettingsService.getMainSettings.mockResolvedValue(totpSettings());

			await userController.loginUser(mockRequest as Request, mockResponse as Response);

			expect(mockCookie).not.toHaveBeenCalled();
			expect(mockSession.regenerate).toHaveBeenCalled();
			expect(mockSession.pendingTotpUser).toBe('testuser');
			expect(mockStatus).toHaveBeenCalledWith(200);
			expect(mockJson).toHaveBeenCalledWith({ success: true, totpRequired: true, error: null });
		});

		it('should log in directly when 2FA is configured but disabled', async () => {
			mockRequest.body = { username: 'testuser', password: 'testpass' };
			mockVerifyPassword.mockReturnValue(true);
			(jwt.sign as jest.Mock).mockReturnValue('mock-token');
			mockSettingsService.getMainSettings.mockResolvedValue(totpSettings(false));

			await userController.loginUser(mockRequest as Request, mockResponse as Response);

			expect(mockCookie).toHaveBeenCalledWith('token', 'mock-token', expect.any(Object));
			expect(mockJson).toHaveBeenCalledWith({ success: true, error: null });
		});

		it('should skip the 2FA step when DISABLE_2FA is set', async () => {
			mockRequest.body = { username: 'testuser', password: 'testpass' };
			mockVerifyPassword.mockReturnValue(true);
			(jwt.sign as jest.Mock).mockReturnValue('mock-token');
			mockSettingsService.getMainSettings.mockResolvedValue(totpSettings());
			(configService.config as any).DISABLE_2FA = true;

			try {
				await userController.loginUser(mockRequest as Request, mockResponse as Response);
			} finally {
				(configService.config as any).DISABLE_2FA = undefined;
			}

			expect(mockSession.regenerate).not.toHaveBeenCalled();
			expect(mockCookie).toHaveBeenCalledWith('token', 'mock-token', expect.any(Object));
			expect(mockJson).toHaveBeenCalledWith({ success: true, error: null });
		});
	});

	describe('verifyTotp', () => {
		beforeEach(() => {
			mockSettingsService.getMainSettings.mockResolvedValue(totpSettings());
			(jwt.sign as jest.Mock).mockReturnValue('mock-token');
		});

		it('should return 401 without a pending password login', async () => {
			mockRequest.body = { code: currentTotpCode() };

			await userController.verifyTotp(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(401);
			expect(mockCookie).not.toHaveBeenCalled();
		});

		it('should set the token cookie for a valid TOTP code', async () => {
			mockSession.pendingTotpUser = 'testuser';
			mockRequest.body = { code: currentTotpCode() };

			await userController.verifyTotp(mockRequest as Request, mockResponse as Response);

			expect(jwt.sign).toHaveBeenCalledWith({ user: 'testuser' }, 'test-secret', {
				expiresIn: '7d',
			});
			expect(mockCookie).toHaveBeenCalledWith('token', 'mock-token', expect.any(Object));
			expect(mockSession.destroy).toHaveBeenCalled();
			expect(mockSettingsService.consumeRecoveryCode).not.toHaveBeenCalled();
			expect(mockJson).toHaveBeenCalledWith({ success: true, error: null });
		});

		it('should accept a valid recovery code', async () => {
			mockSession.pendingTotpUser = 'testuser';
			mockRequest.body = { code: 'ABCDE12345' };
			mockSettingsService.consumeRecoveryCode.mockResolvedValue(true);

			await userController.verifyTotp(mockRequest as Request, mockResponse as Response);

			expect(mockSettingsService.consumeRecoveryCode).toHaveBeenCalledWith('ABCDE12345');
			expect(mockCookie).toHaveBeenCalled();
		});

		it('should accept a recovery code when the TOTP secret cannot be decrypted', async () => {
			const settings = totpSettings();
			settings.settings.totp.secret = new Cryptr('old-secret').encrypt(TOTP_SECRET);
			mockSettingsService.getMainSettings.mockResolvedValue(settings);
			mockSession.pendingTotpUser = 'testuser';
			mockRequest.body = { code: 'ABCDE12345' };
			mockSettingsService.consumeRecoveryCode.mockResolvedValue(true);

			await userController.verifyTotp(mockRequest as Request, mockResponse as Response);

			expect(mockSettingsService.consumeRecoveryCode).toHaveBeenCalledWith('ABCDE12345');
			expect(mockCookie).toHaveBeenCalled();
			expect(mockJson).toHaveBeenCalledWith({ success: true, error: null });
		});

		it('should return 401 for an invalid code and count the attempt', async () => {
			mockSession.pendingTotpUser = 'testuser';
			mockRequest.body = { code: '000000' };

			await userController.verifyTotp(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(401);
			expect(mockCookie).not.toHaveBeenCalled();
			expect(mockSession.totpAttempts).toBe(1);
			expect(mockSession.destroy).not.toHaveBeenCalled();
			expect(mockLoggerWarn).toHaveBeenCalledWith(
				expect.objectContaining({ attempt: 1, serverTime: expect.any(String) }),
				expect.stringContaining('2FA verification failed')
			);
		});

		it('should end the pending login after too many invalid codes', async () => {
			mockSession.pendingTotpUser = 'testuser';
			mockSession.totpAttempts = 4;
			mockRequest.body = { code: '000000' };

			await userController.verifyTotp(mockRequest as Request, mockResponse as Response);

			expect(mockSession.destroy).toHaveBeenCalled();
			expect(mockStatus).toHaveBeenCalledWith(401);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Too many invalid codes. Please log in again.',
			});
		});
	});

	describe('logoutUser', () => {
		it('should clear cookie and return success', async () => {
			await userController.logoutUser(mockRequest as Request, mockResponse as Response);

			expect(mockClearCookie).toHaveBeenCalledWith('token', {
				httpOnly: true,
				sameSite: 'lax',
			});
			expect(mockStatus).toHaveBeenCalledWith(200);
			expect(mockJson).toHaveBeenCalledWith({
				success: true,
				message: 'Logged out successfully',
			});
		});
	});
});
