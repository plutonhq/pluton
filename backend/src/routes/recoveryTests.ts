import { Router } from 'express';
import type { RecoveryTestController } from '../controllers/RecoveryTestController';
import authMiddleware from '../middlewares/authMiddleware';
export function createRecoveryTestRouter(
	controller: RecoveryTestController,
	router: Router = Router()
) {
	router.use(authMiddleware);
	router.get('/:planId/configuration', controller.configuration.bind(controller));
	router.put('/:planId/policy', controller.savePolicy.bind(controller));
	router.put('/:planId/target', controller.saveTarget.bind(controller));
	router.post('/:planId/preparation', controller.preparation.bind(controller));
	router.post('/:planId/database-restores', controller.databaseRestore.bind(controller));
	router.get('/:planId/tests', controller.list.bind(controller));
	router.post('/:planId/tests/lookup', controller.lookup.bind(controller));
	router.post('/:planId/tests', controller.run.bind(controller));
	router.get('/:planId/tests/:id', controller.get.bind(controller));
	router.post('/:planId/tests/:id/cancel', controller.cancel.bind(controller));
	return router;
}
