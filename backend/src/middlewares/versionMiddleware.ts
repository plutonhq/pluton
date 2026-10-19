import { Request, Response, NextFunction } from 'express';
import { getInstallType } from '../utils/installHelpers';
import { configService } from '../services/ConfigService';

// Release/container pipeline supplies installed metadata; no external update feed.
const appVersion: string = process.env.APP_VERSION || 'dev';

/**
 * Middleware that adds local installed build metadata to response headers.
 */
export default function versionMiddleware(req: Request, res: Response, next: NextFunction) {
	// Add version to response headers
	const isSetupPending = configService.isSetupPending();
	res.setHeader('X-App-Version', appVersion);
	const revision = process.env.VCS_REF;
	if (revision && /^[a-f0-9]{7,64}$/i.test(revision)) res.setHeader('X-App-Revision', revision);
	res.setHeader('X-Server-OS', process.platform);
	res.setHeader('X-Install-Type', getInstallType());
	res.setHeader('X-Setup-Pending', isSetupPending ? 1 : 0);
	next();
}
