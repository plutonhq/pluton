import type { Request, Response } from 'express';
import { AppError } from '../utils/AppError';
import type { AgentRequest } from '../types/agents';
import { AgentService } from '../services/AgentService';

export class AgentController {
	constructor(private readonly agentService: AgentService) {}

	async enroll(req: Request, res: Response): Promise<void> {
		try {
			const result = await this.agentService.enroll(req.body);
			res.status(201).json({ success: true, result });
		} catch (error) {
			this.respond(res, error);
		}
	}

	async heartbeat(req: AgentRequest, res: Response): Promise<void> {
		try {
			const result = await this.agentService.heartbeat(req.agent!.agentId, req.body);
			res.json({ success: true, result });
		} catch (error) {
			this.respond(res, error);
		}
	}

	async poll(req: AgentRequest, res: Response): Promise<void> {
		try {
			const result = await this.agentService.poll(req.agent!);
			res.json({ success: true, result });
		} catch (error) {
			this.respond(res, error);
		}
	}

	async acknowledge(req: AgentRequest, res: Response): Promise<void> {
		try {
			await this.agentService.acknowledge(req.agent!.agentId, req.params.id, req.body);
			res.json({ success: true });
		} catch (error) {
			this.respond(res, error);
		}
	}

	async event(req: AgentRequest, res: Response): Promise<void> {
		try {
			await this.agentService.recordEvent(req.agent!.agentId, req.params.id, req.body);
			res.json({ success: true });
		} catch (error) {
			this.respond(res, error);
		}
	}

	async complete(req: AgentRequest, res: Response): Promise<void> {
		try {
			await this.agentService.complete(req.agent!.agentId, req.params.id, req.body);
			res.json({ success: true });
		} catch (error) {
			this.respond(res, error);
		}
	}

	async commandStatus(req: AgentRequest, res: Response): Promise<void> {
		try {
			const result = await this.agentService.commandStatus(
				req.agent!.agentId,
				req.params.id,
				req.body
			);
			res.json({ success: true, result });
		} catch (error) {
			this.respond(res, error);
		}
	}

	private respond(res: Response, error: unknown): void {
		const status = error instanceof AppError ? error.statusCode : 500;
		const message = error instanceof AppError ? error.message : 'Agent request failed.';
		res.status(status).json({ success: false, error: message });
	}
}
