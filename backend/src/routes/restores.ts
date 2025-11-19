import { Router } from 'express';
import { RestoreController } from '../controllers/RestoreController';
import authM from '../middlewares/authMiddleware';

export function createRestoreRouter(
	controller: RestoreController,
	router: Router = Router()
): Router {
	router.get('/', authM, controller.listRestores.bind(controller));
	router.get('/:id', authM, controller.getRestore.bind(controller));
	router.get('/:id/stats', authM, controller.getRestoreStats.bind(controller));
	router.delete('/:id', authM, controller.deleteRestore.bind(controller));
	router.get('/:id/progress', authM, controller.getRestoreProgress.bind(controller));
	router.post('/:id/action/cancel', authM, controller.cancelRestore.bind(controller));
	router.post('/action/dryrestore', authM, controller.performDryRestore.bind(controller));
	router.post('/action/restore', authM, controller.performRestore.bind(controller));

	return router;
}
