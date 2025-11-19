import { Request, Response, NextFunction } from 'express';

// Read package.json once at startup
let appVersion: string = process.env.APP_VERSION || 'dev';
/**
 * Middleware that adds the application version from package.json to response headers
 */
export default function versionMiddleware(req: Request, res: Response, next: NextFunction) {
	// Add version to response headers
	res.setHeader('X-App-Version', appVersion);
	res.setHeader('X-SERVER-OS', process.platform);
	next();
}
