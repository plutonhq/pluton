import { NextFunction } from 'express';

// Handles async errors of express routes with the errorHandlerMiddleware
const asyncHandler =
	(fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) =>
	(req: Request, res: Response, next: NextFunction) =>
		Promise.resolve(fn(req, res, next)).catch(next);

export default asyncHandler;
