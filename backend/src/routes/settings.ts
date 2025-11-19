import { Router } from 'express';
import { SettingsController } from '../controllers/SettingsController';
import authM from '../middlewares/authMiddleware';

export function createSettingsRouter(
	controller: SettingsController,
	router: Router = Router()
): Router {
	router.get('/', authM, controller.getMainSettings.bind(controller));
	router.get('/:id', authM, controller.getSettings.bind(controller));
	router.put('/:id', authM, controller.updateSettings.bind(controller));
	router.get('/:id/logs', authM, controller.getAppLogs.bind(controller));
	router.get('/:id/logs/download', authM, controller.downloadAppLogs.bind(controller));
	router.post('/integration/validate', authM, controller.validateIntegration.bind(controller));

	return router;
}
