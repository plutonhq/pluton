import { Request, Response, NextFunction } from 'express';
import { errorHandlerMiddleware } from '../../src/middlewares/errorHandlerMiddleware';
import { AppError, NotFoundError, BadRequestError } from '../../src/utils/AppError';

// Mock logger
jest.mock('../../src/utils/logger', () => ({
	logger: {
		warn: jest.fn(),
		error: jest.fn(),
	},
}));

import { logger } from '../../src/utils/logger';

const mockLogger = logger as jest.Mocked<typeof logger>;

describe('errorHandlerMiddleware', () => {
	let req: Partial<Request>;
	let res: Partial<Response>;
	let next: NextFunction;
	let jsonFn: jest.Mock;
	let statusFn: jest.Mock;

	beforeEach(() => {
		jest.clearAllMocks();

		jsonFn = jest.fn();
		statusFn = jest.fn().mockReturnValue({ json: jsonFn });

		req = { path: '/test-path' };
		res = { status: statusFn } as Partial<Response>;
		next = jest.fn();
	});

	it('should return correct statusCode and json for AppError', () => {
		const error = new AppError(422, 'Unprocessable Entity');

		errorHandlerMiddleware(error, req as Request, res as Response, next);

		expect(statusFn).toHaveBeenCalledWith(422);
		expect(jsonFn).toHaveBeenCalledWith({
			success: false,
			error: 'Unprocessable Entity',
		});
	});

	it('should return 404 for NotFoundError', () => {
		const error = new NotFoundError('Resource not found');

		errorHandlerMiddleware(error, req as Request, res as Response, next);

		expect(statusFn).toHaveBeenCalledWith(404);
		expect(jsonFn).toHaveBeenCalledWith({
			success: false,
			error: 'Resource not found',
		});
	});

	it('should return 400 for BadRequestError', () => {
		const error = new BadRequestError('Invalid input');

		errorHandlerMiddleware(error, req as Request, res as Response, next);

		expect(statusFn).toHaveBeenCalledWith(400);
		expect(jsonFn).toHaveBeenCalledWith({
			success: false,
			error: 'Invalid input',
		});
	});

	it('should return 500 with "Internal Server Error" for generic Error', () => {
		const error = new Error('Something went wrong');

		errorHandlerMiddleware(error, req as Request, res as Response, next);

		expect(statusFn).toHaveBeenCalledWith(500);
		expect(jsonFn).toHaveBeenCalledWith({
			success: false,
			error: 'Internal Server Error',
		});
	});

	it('should call logger.warn for AppError', () => {
		const error = new AppError(403, 'Forbidden');

		errorHandlerMiddleware(error, req as Request, res as Response, next);

		expect(mockLogger.warn).toHaveBeenCalledWith({
			module: 'ErrorHandler',
			statusCode: 403,
			message: 'Forbidden',
			path: '/test-path',
		});
		expect(mockLogger.error).not.toHaveBeenCalled();
	});

	it('should call logger.error for generic Error', () => {
		const error = new Error('Unexpected failure');

		errorHandlerMiddleware(error, req as Request, res as Response, next);

		expect(mockLogger.error).toHaveBeenCalledWith(
			expect.objectContaining({
				module: 'ErrorHandler',
				path: '/test-path',
			}),
			'An unexpected error occurred'
		);
		expect(mockLogger.warn).not.toHaveBeenCalled();
	});
});
