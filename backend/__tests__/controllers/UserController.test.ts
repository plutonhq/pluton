import { Request, Response } from 'express';
import { UserController } from '../../src/controllers/UserController';
import { configService } from '../../src/services/ConfigService';
import jwt from 'jsonwebtoken';

jest.mock('jsonwebtoken');

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

		mockRequest = {
			body: {},
		};

		userController = new UserController();
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
