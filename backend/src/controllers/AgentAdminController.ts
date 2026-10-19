import type { Request, Response } from 'express';
import { AppError } from '../utils/AppError';
import { AgentService } from '../services/AgentService';

export class AgentAdminController {
	constructor(private readonly agentService: AgentService) {}

	async createEnrollment(req: Request, res: Response): Promise<void> {
		try {
			const result = await this.agentService.createEnrollment(req.body);
			res.status(201).json({ success: true, result });
		} catch (error) {
			this.respond(res, error);
		}
	}

	async revokeEnrollment(req: Request, res: Response): Promise<void> {
		try {
			await this.agentService.revokeEnrollment(req.params.id);
			res.json({ success: true });
		} catch (error) {
			this.respond(res, error);
		}
	}

	async revokeDevice(req: Request, res: Response): Promise<void> {
		try {
			await this.agentService.revokeDevice(req.params.id);
			res.json({ success: true });
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
