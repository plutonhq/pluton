import type { NextFunction, Response } from 'express';
import type { AgentRequest } from '../types/agents';
import { AppError } from '../utils/AppError';
import { AgentService } from '../services/AgentService';

function respond(res: Response, error: unknown): void {
	const status = error instanceof AppError ? error.statusCode : 500;
	const message = error instanceof AppError ? error.message : 'Agent request failed.';
	res.status(status).json({ success: false, error: message });
}

/** Enforces the server-side half of the explicit insecure-LAN exception. */
export function agentTransportMiddleware(agentService: AgentService) {
	return (req: AgentRequest, res: Response, next: NextFunction): void => {
		try {
			agentService.assertTransportIsAllowed(req.secure || req.protocol === 'https');
			next();
		} catch (error) {
			respond(res, error);
		}
	};
}

/** Agent HMAC authentication; browser sessions and generic API keys are never accepted here. */
export function agentAuthMiddleware(agentService: AgentService) {
	return async (req: AgentRequest, res: Response, next: NextFunction): Promise<void> => {
		try {
			agentService.assertTransportIsAllowed(req.secure || req.protocol === 'https');
			const agent = await agentService.authenticate({
				agentId: req.header('x-pluton-agent-id') || undefined,
				timestamp: req.header('x-pluton-agent-timestamp') || undefined,
				nonce: req.header('x-pluton-agent-nonce') || undefined,
				signature: req.header('x-pluton-agent-signature') || undefined,
				method: req.method,
				path: req.originalUrl.split('?')[0],
				body: req.rawBody || '',
			});
			req.agent = agent;
			next();
		} catch (error) {
			respond(res, error);
		}
	};
}
