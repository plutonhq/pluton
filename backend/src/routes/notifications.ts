import {
	Router,
	type Request,
	type Response,
	type NextFunction,
	type ErrorRequestHandler,
} from 'express';
import rateLimit from 'express-rate-limit';
import authMiddleware from '../middlewares/authMiddleware';
import { configService } from '../services/ConfigService';
import { AppError } from '../utils/AppError';
import type { NotificationDeliveryStore } from '../stores/NotificationDeliveryStore';
import type { Delivery } from '../types/notificationDelivery';
import { parseWebOrigins, sameOriginJson } from '../utils/webOrigins';
function publicDelivery(row: Delivery) {
	const { leaseOwner: _owner, ...view } = row;
	return view;
}
/** Body-parser errors may quote the submitted credential. Never send/log them. */
export const notificationInputError: ErrorRequestHandler = (error, req, res, next) => {
	if (
		/^\/api\/(notifications|settings)(\/|$)/.test(req.originalUrl) &&
		(error?.type === 'entity.parse.failed' || error?.type === 'entity.too.large')
	) {
		res
			.status(error.type === 'entity.too.large' ? 413 : 400)
			.json({ success: false, error: 'Invalid or oversized notification/settings JSON payload.' });
		return;
	}
	next(error);
};
export function notificationOriginGuard(req: Request, res: Response, next: NextFunction) {
	if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
	if (!sameOriginJson(req, parseWebOrigins(configService.config))) {
		res.status(403).json({
			success: false,
			error: 'Notification changes require an authenticated same-origin JSON request.',
		});
		return;
	}
	next();
}
export function createNotificationRouter(
	store: NotificationDeliveryStore,
	router: Router = Router()
) {
	router.use(authMiddleware, notificationOriginGuard);
	router.use((_req, res, next) => {
		res.setHeader('Cache-Control', 'no-store');
		next();
	});
	const testLimit = rateLimit({
		windowMs: 60000,
		max: 10,
		standardHeaders: true,
		legacyHeaders: false,
		message: { success: false, error: 'Too many test or retry requests. Wait one minute.' },
	});
	const action =
		(run: (req: Request) => unknown, status = 200) =>
		(req: Request, res: Response) => {
			try {
				res.status(status).json({ success: true, result: run(req) });
			} catch (error) {
				res.status(error instanceof AppError ? error.statusCode : 500).json({
					success: false,
					error: error instanceof AppError ? error.message : 'Notification request failed.',
				});
			}
		};
	router.get(
		'/channels',
		action(() => store.channels())
	);
	router.post(
		'/channels',
		action(req => store.saveChannel(req.body), 201)
	);
	router.put(
		'/channels/:id',
		action(req => store.saveChannel(req.body, req.params.id))
	);
	router.delete(
		'/channels/:id',
		action(req => {
			store.deleteChannel(req.params.id);
			return { deleted: true };
		})
	);
	router.post(
		'/channels/:id/test',
		testLimit,
		action(req => publicDelivery(store.test(req.params.id)), 202)
	);
	router.get(
		'/plans/:id',
		action(req => store.subscription(req.params.id))
	);
	router.put(
		'/plans/:id',
		action(req => store.saveSubscription(req.params.id, req.body))
	);
	router.get(
		'/deliveries',
		action(req => {
			const page = Number(req.query.page || 0);
			if (!Number.isInteger(page) || page < 0 || page > 400)
				throw new AppError(400, 'Choose a valid history page.');
			return store.deliveries(50, page * 50).map(publicDelivery);
		})
	);
	router.get(
		'/deliveries/:id',
		action(req => {
			const row = store.delivery(req.params.id);
			if (!row) throw new AppError(404, 'Notification delivery not found.');
			return publicDelivery(row);
		})
	);
	router.post(
		'/deliveries/:id/retry',
		testLimit,
		action(req => publicDelivery(store.retry(req.params.id)), 202)
	);
	return router;
}
