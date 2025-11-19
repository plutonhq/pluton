import { Router } from 'express';
import { DeviceController } from '../controllers/DeviceController';
import authM from '../middlewares/authMiddleware';

const router = Router();

export function createDeviceRouter(
	controller: DeviceController,
	router: Router = Router()
): Router {
	router.get('/', authM, controller.getDevices.bind(controller));
	router.get('/:id', authM, controller.getDevice.bind(controller));
	router.put('/:id', authM, controller.updateDevice.bind(controller));
	router.get('/:id/metrics', authM, controller.getMetrics.bind(controller));
	router.get('/:id/browse', authM, controller.getBrowsePath.bind(controller));
	router.post('/:id/action/update/restic', authM, controller.updateRestic.bind(controller));
	router.post('/:id/action/update/rclone', authM, controller.updateRclone.bind(controller));

	return router;
}
