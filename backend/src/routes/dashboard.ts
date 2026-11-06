import { Router } from 'express';
import { DashboardController } from '../controllers/DashboardController';
import authM from '../middlewares/authMiddleware';

export function createDashboardRouter(
	controller: DashboardController,
	router: Router = Router()
): Router {
	router.get('/summary', authM, controller.getSummary.bind(controller));
	router.get('/system', authM, controller.getSystem.bind(controller));
	router.get('/events', authM, controller.getEvents.bind(controller));

	return router;
}
