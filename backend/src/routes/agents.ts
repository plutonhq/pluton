import { Router } from 'express';
import { AgentController } from '../controllers/AgentController';
import { agentAuthMiddleware, agentTransportMiddleware } from '../middlewares/agentAuthMiddleware';
import { AgentService } from '../services/AgentService';

/** Agent-only HMAC routes. They intentionally do not use authMiddleware. */
export function createAgentRouter(
	controller: AgentController,
	service: AgentService,
	router: Router = Router()
): Router {
	const transport = agentTransportMiddleware(service);
	const authenticated = agentAuthMiddleware(service);
	router.post('/enroll', transport, controller.enroll.bind(controller));
	router.post('/heartbeat', authenticated, controller.heartbeat.bind(controller));
	router.post('/poll', authenticated, controller.poll.bind(controller));
	router.post('/commands/:id/ack', authenticated, controller.acknowledge.bind(controller));
	router.post('/commands/:id/events', authenticated, controller.event.bind(controller));
	router.post('/commands/:id/complete', authenticated, controller.complete.bind(controller));
	router.post('/commands/:id/status', authenticated, controller.commandStatus.bind(controller));
	return router;
}
