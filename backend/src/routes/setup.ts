import { Router } from 'express';
import { SetupController } from '../controllers/SetupController';

export function createSetupRouter(controller: SetupController): Router {
	const router = Router();

	router.get('/status', (req, res) => controller.getStatus(req, res));
	router.post('/complete', (req, res) => controller.completeSetup(req, res));
	router.get('/keyring-check', (req, res) => controller.checkKeyringAvailability(req, res));

	return router;
}
