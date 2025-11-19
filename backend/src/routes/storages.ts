import { Router } from 'express';
import { StorageController } from '../controllers/StorageController';
import authM from '../middlewares/authMiddleware';

export function createStorageRouter(
	controller: StorageController,
	router: Router = Router()
): Router {
	router.post('/', authM, controller.createStorage.bind(controller));
	router.get('/', authM, controller.listStorages.bind(controller));
	router.get('/available', authM, controller.listAvailableStorageTypes.bind(controller));
	router.get('/:id', authM, controller.getStorage.bind(controller));
	router.put('/:id', authM, controller.updateStorage.bind(controller));
	router.delete('/:id', authM, controller.deleteStorage.bind(controller));
	router.post('/verify/:id', authM, controller.verifyStorage.bind(controller));
	// router.post('/auth', controller.authorizeStorage.bind(controller));

	return router;
}
