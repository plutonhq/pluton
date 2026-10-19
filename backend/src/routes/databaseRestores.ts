import {
	Router,
	type Request,
	type Response,
	type NextFunction,
	type ErrorRequestHandler,
} from 'express';
import rateLimit from 'express-rate-limit';
import Cookies from 'cookies';
import jwt from 'jsonwebtoken';
import authMiddleware from '../middlewares/authMiddleware';
import { configService } from '../services/ConfigService';
import type { DatabaseRestoreService } from '../services/DatabaseRestoreService';
import { AppError } from '../utils/AppError';
import { parseWebOrigins, sameOriginJson } from '../utils/webOrigins';

export const databaseRestoreInputError: ErrorRequestHandler = (error, req, res, next) => {
	if (
		/^\/api\/database-restores(?:\/|$)/.test(req.originalUrl) &&
		['entity.parse.failed', 'entity.too.large'].includes(error?.type)
	) {
		res.setHeader('Cache-Control', 'no-store');
		res
			.status(error.type === 'entity.too.large' ? 413 : 400)
			.json({ success: false, error: 'Invalid or oversized database restore JSON.' });
		return;
	}
	next(error);
};
export function databaseRestoreAdmin(req: Request, res: Response, next: NextFunction) {
	try {
		const token = new Cookies(req, res).get('token');
		const decoded = jwt.verify(token || '', configService.config.SECRET);
		if (
			typeof decoded === 'string' ||
			typeof decoded.user !== 'string' ||
			![configService.config.USER_NAME, 'admin'].includes(decoded.user)
		)
			throw new Error();
		// This application currently has one local administrator, not a multi-user RBAC model.
		res.locals.restoreOwner = 'administrator';
	} catch {
		res.status(403).json({ success: false, error: 'Administrator authorization required.' });
		return;
	}
	if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
		if (
			!sameOriginJson(req, parseWebOrigins(configService.config)) ||
			Number(req.headers['content-length'] || 0) > 8192
		) {
			res.status(403).json({ success: false, error: 'Restore changes require same-origin JSON.' });
			return;
		}
	}
	res.setHeader('Cache-Control', 'no-store');
	res.setHeader('Pragma', 'no-cache');
	next();
}
export function createDatabaseRestoreRouter(
	service: DatabaseRestoreService,
	router: Router = Router()
) {
	router.use((_req, res, next) => {
		res.setHeader('Cache-Control', 'no-store');
		next();
	});
	router.use(authMiddleware, databaseRestoreAdmin);
	router.use(
		rateLimit({
			windowMs: 60000,
			max: 60,
			standardHeaders: true,
			legacyHeaders: false,
			message: { success: false, error: 'Too many database restore requests.' },
		})
	);
	const mutationLimit = rateLimit({
		windowMs: 60000,
		max: 10,
		standardHeaders: true,
		legacyHeaders: false,
		message: { success: false, error: 'Too many restore operations. Wait one minute.' },
	});
	const action =
		(run: (req: Request, res: Response) => unknown, status = 200) =>
		async (req: Request, res: Response) => {
			try {
				res.status(status).json({ success: true, result: await run(req, res) });
			} catch (error) {
				res
					.status(error instanceof AppError ? error.statusCode : 500)
					.json({
						success: false,
						error: error instanceof AppError ? error.message : 'Database restore request failed.',
					});
			}
		};
	router.post(
		'/preparation',
		mutationLimit,
		action(req => service.preview(req.body))
	);
	router.post(
		'/',
		mutationLimit,
		action((req, res) => service.create(req.body, res.locals.restoreOwner), 202)
	);
	router.get(
		'/',
		action((_req, res) => service.list(res.locals.restoreOwner))
	);
	router.get(
		'/:id',
		action((req, res) => service.get(req.params.id, res.locals.restoreOwner))
	);
	router.post(
		'/:id/inspect',
		mutationLimit,
		action((req, res) => service.inspect(req.params.id, res.locals.restoreOwner))
	);
	router.post(
		'/:id/delete',
		mutationLimit,
		action((req, res) => service.delete(req.params.id, res.locals.restoreOwner, req.body), 202)
	);
	for (const operation of ['provision', 'stop', 'resume'] as const)
		router.post(
			`/:id/${operation}`,
			mutationLimit,
			action((req, res) => {
				if (!req.body || Object.keys(req.body).length)
					throw new AppError(400, 'No operator arguments are accepted.');
				return service.operator(req.params.id, res.locals.restoreOwner, operation);
			}, 202)
		);
	return router;
}
