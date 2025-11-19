import { Router } from 'express';
import { PlanController } from '../controllers/PlanController';
import authM from '../middlewares/authMiddleware';

export function createPlanRouter(controller: PlanController, router: Router = Router()): Router {
	router.get('/', authM, controller.getPlans.bind(controller));
	router.get('/:id', authM, controller.getPlan.bind(controller));
	router.post('/', authM, controller.createPlan.bind(controller));
	router.put('/:id', authM, controller.updatePlan.bind(controller));
	router.delete('/:id', authM, controller.deletePlan.bind(controller));
	router.get('/:id/logs', authM, controller.getLogs.bind(controller));
	router.get('/:id/logs/download', authM, controller.downloadLogs.bind(controller));
	router.get('/:id/checkactive', authM, controller.checkActiveBackups.bind(controller));
	router.post('/:id/action/backup', authM, controller.performBackup.bind(controller));
	router.post('/:id/action/resume', authM, controller.resumeBackup.bind(controller));
	router.post('/:id/action/pause', authM, controller.pauseBackup.bind(controller));
	router.post('/:id/action/prune', authM, controller.pruneBackup.bind(controller));
	router.post('/:id/action/unlock', authM, controller.unlockRepo.bind(controller));

	return router;
}
