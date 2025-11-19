import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError';
import { logger } from '../utils/logger';

export const errorHandlerMiddleware = (
	err: Error,
	req: Request,
	res: Response,
	next: NextFunction
): void => {
	// If the error is an instance of our custom AppError, we can trust its properties.
	if (err instanceof AppError) {
		logger.warn({
			module: 'ErrorHandler',
			statusCode: err.statusCode,
			message: err.message,
			path: req.path,
		});

		res.status(err.statusCode).json({
			success: false,
			error: err.message,
		});
		return;
	}

	// For all other unexpected errors, log them as critical and return a generic 500.
	// This prevents leaking sensitive implementation details to the client.
	logger.error(
		{
			module: 'ErrorHandler',
			error: err.stack, // Log the full stack trace for debugging
			path: req.path,
		},
		'An unexpected error occurred'
	);

	res.status(500).json({
		success: false,
		error: 'Internal Server Error',
	});
};

// Handles async errors of express routes with the errorHandlerMiddleware
const asyncHandler =
	(fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) =>
	(req: Request, res: Response, next: NextFunction) =>
		Promise.resolve(fn(req, res, next)).catch(next);

export default asyncHandler;
