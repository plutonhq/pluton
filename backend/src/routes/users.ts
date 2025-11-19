import { Router } from 'express';
import { UserController } from '../controllers/UserController';
import authM from '../middlewares/authMiddleware';

export function createUserRouter(controller: UserController, router: Router = Router()): Router {
	router.post('/login', controller.loginUser.bind(controller));
	router.get('/validate', authM, controller.validateUser.bind(controller));
	router.post('/logout', authM, controller.logoutUser.bind(controller));

	return router;
}
