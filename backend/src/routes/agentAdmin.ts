import { Router } from 'express';
import { AgentAdminController } from '../controllers/AgentAdminController';
import authMiddleware from '../middlewares/authMiddleware';

/** Browser/session administration routes, kept separate from /api/agent. */
export function createAgentAdminRouter(
	controller: AgentAdminController,
	router: Router = Router()
): Router {
	router.post('/enrollments', authMiddleware, controller.createEnrollment.bind(controller));
	router.post('/enrollments/:id/revoke', authMiddleware, controller.revokeEnrollment.bind(controller));
	router.post('/devices/:id/revoke', authMiddleware, controller.revokeDevice.bind(controller));
	return router;
}
