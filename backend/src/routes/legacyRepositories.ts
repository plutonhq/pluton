import { Router } from 'express';
import authMiddleware from '../middlewares/authMiddleware';
import { LegacyRepositoryController } from '../controllers/LegacyRepositoryController';

/**
 * All endpoints require the authenticated UI session. API-key access is not
 * included in authMiddleware's restricted machine API allowlist.
 */
export function createLegacyRepositoryRouter(
	controller: LegacyRepositoryController,
	router: Router = Router()
): Router {
	router.get('/', authMiddleware, controller.list.bind(controller));
	router.post('/', authMiddleware, controller.create.bind(controller));
	router.get('/:id', authMiddleware, controller.get.bind(controller));
	router.post('/:id/validate', authMiddleware, controller.validate.bind(controller));
	router.get('/:id/snapshots', authMiddleware, controller.listSnapshots.bind(controller));
	router.get('/:id/snapshots/:snapshotId', authMiddleware, controller.getSnapshot.bind(controller));
	router.get('/:id/snapshots/:snapshotId/tree', authMiddleware, controller.listSnapshotDirectory.bind(controller));
	router.get('/:id/stats', authMiddleware, controller.getStats.bind(controller));
	router.post('/:id/restores', authMiddleware, controller.createRestore.bind(controller));
	router.get('/:id/restores/:jobId', authMiddleware, controller.getRestore.bind(controller));
	router.post('/:id/restores/:jobId/cancel', authMiddleware, controller.cancelRestore.bind(controller));
	router.get('/:id/restores/:jobId/files', authMiddleware, controller.downloadRestoredFile.bind(controller));
	router.delete('/:id', authMiddleware, controller.delete.bind(controller));

	return router;
}
