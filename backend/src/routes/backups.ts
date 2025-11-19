import { Router } from 'express';
import { BackupController } from '../controllers/BackupController';
import authM from '../middlewares/authMiddleware';

export function createBackupRouter(
	controller: BackupController,
	router: Router = Router()
): Router {
	router.delete('/:id', authM, controller.deleteBackup.bind(controller));
	router.get('/:id/files', authM, controller.getSnapshotFiles.bind(controller));
	router.get('/:id/progress', authM, controller.getBackupProgress.bind(controller));
	router.post('/:id/action/cancel', authM, controller.cancelBackup.bind(controller));
	router.get('/:id/action/download', authM, controller.getBackupDownload.bind(controller));
	router.post('/:id/action/download', authM, controller.generateBackupDownload.bind(controller));
	router.delete('/:id/action/download', authM, controller.cancelBackupDownload.bind(controller));

	return router;
}
