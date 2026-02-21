import { Router, type RequestHandler } from 'express';
import { UserController } from '../controllers/UserController';
import authM from '../middlewares/authMiddleware';

export function createUserRouter(
	controller: UserController,
	authLimiter?: RequestHandler,
	router: Router = Router()
): Router {
	const loginMiddlewares: RequestHandler[] = authLimiter ? [authLimiter] : [];
	router.post('/login', ...loginMiddlewares, controller.loginUser.bind(controller));
	router.get('/validate', authM, controller.validateUser.bind(controller));
	router.post('/logout', authM, controller.logoutUser.bind(controller));

	return router;
}
