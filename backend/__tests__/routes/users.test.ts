import request from 'supertest';
import express, { Express } from 'express';
import { createUserRouter } from '../../src/routes/users';
import { UserController } from '../../src/controllers/UserController';
import { configService } from '../../src/services/ConfigService';
import jwt from 'jsonwebtoken';
import Cookies from 'cookies';

jest.mock('jsonwebtoken');
jest.mock('cookies');

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

describe('User Routes', () => {
	let app: Express;
	let userController: UserController;

	beforeEach(() => {
		jest.clearAllMocks();
		mockVerifyPassword.mockReturnValue(false);
		mockHashAndStorePassword.mockReturnValue('$2a$10$mockhash');
		userController = new UserController();

		app = express();
		app.use(express.json());
		app.use('/api/user', createUserRouter(userController));
	});

	describe('POST /api/user/login', () => {
		it('should return 401 if username is missing', async () => {
			const response = await request(app).post('/api/user/login').send({ password: 'testpass' });

			expect(response.status).toBe(401);
			expect(response.body).toEqual({ error: 'Username & Password Missing' });
		});

		it('should return 401 if password is missing', async () => {
			const response = await request(app).post('/api/user/login').send({ username: 'testuser' });

			expect(response.status).toBe(401);
			expect(response.body).toEqual({ error: 'Username & Password Missing' });
		});

		it('should return 401 if username is incorrect', async () => {
			mockVerifyPassword.mockReturnValue(true);
			const response = await request(app)
				.post('/api/user/login')
				.send({ username: 'wronguser', password: 'testpass' });

			expect(response.status).toBe(401);
			expect(response.body).toEqual({ success: false, error: 'Incorrect Username or Password' });
		});

		it('should return 401 if password is incorrect', async () => {
			mockVerifyPassword.mockReturnValue(false);
			const response = await request(app)
				.post('/api/user/login')
				.send({ username: 'testuser', password: 'wrongpass' });

			expect(response.status).toBe(401);
			expect(response.body).toEqual({ success: false, error: 'Incorrect Username or Password' });
		});

		it('should successfully login with correct credentials', async () => {
			(jwt.sign as jest.Mock).mockReturnValue('mock-token');
			mockVerifyPassword.mockReturnValue(true);

			const response = await request(app)
				.post('/api/user/login')
				.send({ username: 'testuser', password: 'testpass' });

			expect(response.status).toBe(200);
			expect(response.body).toEqual({ success: true, error: null });
			expect(jwt.sign).toHaveBeenCalledWith({ user: 'testuser' }, 'test-secret', {
				expiresIn: '7d',
			});
		});
	});

	describe('GET /api/user/validate', () => {
		it('should return 401 if no token is provided', async () => {
			(Cookies as jest.MockedClass<typeof Cookies>).mockImplementation(
				() =>
					({
						get: jest.fn().mockReturnValue(null),
					}) as any
			);

			const response = await request(app).get('/api/user/validate');

			expect(response.status).toBe(401);
		});

		it('should return 200 if valid token is provided', async () => {
			(Cookies as jest.MockedClass<typeof Cookies>).mockImplementation(
				() =>
					({
						get: jest.fn().mockReturnValue('valid-token'),
					}) as any
			);
			(jwt.verify as jest.Mock).mockImplementation((token, secret, callback) => {
				callback(null, { user: 'testuser' });
			});

			const response = await request(app)
				.get('/api/user/validate')
				.set('Cookie', ['token=valid-token']);

			expect(response.status).toBe(200);
			expect(response.body).toEqual({ success: true });
		});
	});

	describe('POST /api/user/logout', () => {
		it('should return 401 if no token is provided', async () => {
			(Cookies as jest.MockedClass<typeof Cookies>).mockImplementation(
				() =>
					({
						get: jest.fn().mockReturnValue(null),
					}) as any
			);

			const response = await request(app).post('/api/user/logout');

			expect(response.status).toBe(401);
		});

		it('should successfully logout when authenticated', async () => {
			const mockClearCookie = jest.fn();
			(Cookies as jest.MockedClass<typeof Cookies>).mockImplementation(
				() =>
					({
						get: jest.fn().mockReturnValue('valid-token'),
						set: mockClearCookie,
					}) as any
			);
			(jwt.verify as jest.Mock).mockImplementation((token, secret, callback) => {
				callback(null, { user: 'testuser' });
			});

			const response = await request(app)
				.post('/api/user/logout')
				.set('Cookie', ['token=valid-token']);

			expect(response.status).toBe(200);
			expect(response.body).toEqual({ success: true, message: 'Logged out successfully' });
		});
	});
});
