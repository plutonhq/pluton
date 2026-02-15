import { Request, Response, NextFunction } from 'express';
import authMiddleware from '../../src/middlewares/authMiddleware';

// Mock jsonwebtoken
jest.mock('jsonwebtoken', () => ({
	verify: jest.fn(),
}));

// Mock cookies
jest.mock('cookies', () => {
	return jest.fn().mockImplementation(() => ({
		get: jest.fn().mockReturnValue(null),
	}));
});

// Mock ConfigService
jest.mock('../../src/services/ConfigService', () => ({
	configService: {
		config: {
			SECRET: 'test-secret',
			APIKEY: 'test-key',
		},
	},
}));

import jwt from 'jsonwebtoken';
import Cookies from 'cookies';

const mockJwtVerify = jwt.verify as jest.Mock;
const MockCookies = Cookies as unknown as jest.Mock;

describe('authMiddleware', () => {
	let req: Partial<Request>;
	let res: Partial<Response>;
	let next: NextFunction;
	let jsonFn: jest.Mock;
	let statusFn: jest.Mock;

	beforeEach(() => {
		jest.clearAllMocks();

		jsonFn = jest.fn();
		statusFn = jest.fn().mockReturnValue({ json: jsonFn });

		req = {
			headers: {},
			url: '/api/plans',
			method: 'GET',
		};
		res = { status: statusFn } as Partial<Response>;
		next = jest.fn();
	});

	it('should call next() for a valid JWT token', () => {
		MockCookies.mockImplementation(() => ({
			get: jest.fn().mockReturnValue('valid-jwt-token'),
		}));
		mockJwtVerify.mockImplementation((_token: string, _secret: string, cb: (err: any) => void) => {
			cb(null);
		});

		authMiddleware(req as Request, res as Response, next);

		expect(mockJwtVerify).toHaveBeenCalledWith(
			'valid-jwt-token',
			'test-secret',
			expect.any(Function)
		);
		expect(next).toHaveBeenCalled();
		expect(statusFn).not.toHaveBeenCalled();
	});

	it('should return 401 when no token is provided', () => {
		MockCookies.mockImplementation(() => ({
			get: jest.fn().mockReturnValue(null),
		}));

		authMiddleware(req as Request, res as Response, next);

		expect(statusFn).toHaveBeenCalledWith(401);
		expect(jsonFn).toHaveBeenCalledWith({ error: 'Not authorized' });
		expect(next).not.toHaveBeenCalled();
	});

	it('should return 401 when JWT is invalid', () => {
		MockCookies.mockImplementation(() => ({
			get: jest.fn().mockReturnValue('invalid-jwt-token'),
		}));
		mockJwtVerify.mockImplementation((_token: string, _secret: string, cb: (err: any) => void) => {
			cb(new Error('jwt malformed'));
		});

		authMiddleware(req as Request, res as Response, next);

		expect(statusFn).toHaveBeenCalledWith(401);
		expect(jsonFn).toHaveBeenCalledWith({ error: 'Not authorized' });
		expect(next).not.toHaveBeenCalled();
	});

	it('should call next() for valid API key on an allowed route', () => {
		MockCookies.mockImplementation(() => ({
			get: jest.fn().mockReturnValue(null),
		}));

		req.headers = { authorization: 'Bearer test-key' };
		req.url = '/api/plans';
		req.method = 'GET';

		authMiddleware(req as Request, res as Response, next);

		expect(next).toHaveBeenCalled();
		expect(statusFn).not.toHaveBeenCalled();
	});

	it('should return 401 for valid API key on a disallowed route', () => {
		MockCookies.mockImplementation(() => ({
			get: jest.fn().mockReturnValue(null),
		}));

		req.headers = { authorization: 'Bearer test-key' };
		req.url = '/api/settings';
		req.method = 'GET';

		authMiddleware(req as Request, res as Response, next);

		expect(statusFn).toHaveBeenCalledWith(401);
		expect(jsonFn).toHaveBeenCalledWith({ error: 'This Route cannot be accessed with API.' });
		expect(next).not.toHaveBeenCalled();
	});

	it('should return 401 for an invalid API key', () => {
		MockCookies.mockImplementation(() => ({
			get: jest.fn().mockReturnValue(null),
		}));

		req.headers = { authorization: 'Bearer wrong-key' };
		req.url = '/api/plans';
		req.method = 'GET';

		authMiddleware(req as Request, res as Response, next);

		expect(statusFn).toHaveBeenCalledWith(401);
		expect(jsonFn).toHaveBeenCalledWith({ error: 'Invalid API Key Provided.' });
		expect(next).not.toHaveBeenCalled();
	});
});
