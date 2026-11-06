import { Request, Response } from 'express';
import { DashboardService } from '../services/DashboardService';
import { DashboardEventType } from '../types/dashboard';

const EVENT_TYPES = ['all', 'success', 'warning', 'failure'];

export class DashboardController {
	constructor(protected dashboardService: DashboardService) {}

	async getSummary(req: Request, res: Response): Promise<void> {
		try {
			const months = Math.min(Math.max(parseInt(req.query.months as string) || 6, 1), 24);
			const result = await this.dashboardService.getSummary(months);
			res.json({ success: true, result });
		} catch (error: any) {
			res.status(500).json({ success: false, error: 'Failed to fetch dashboard summary' });
		}
	}

	async getSystem(req: Request, res: Response): Promise<void> {
		try {
			const result = await this.dashboardService.getSystem();
			res.json({ success: true, result });
		} catch (error: any) {
			res.status(500).json({ success: false, error: 'Failed to fetch system status' });
		}
	}

	async getEvents(req: Request, res: Response): Promise<void> {
		try {
			const type = (req.query.type as string) || 'all';
			if (!EVENT_TYPES.includes(type)) {
				res.status(400).json({ success: false, error: 'Invalid event type' });
				return;
			}
			const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 500);
			const result = await this.dashboardService.getEvents(
				type as DashboardEventType | 'all',
				limit
			);
			res.json({ success: true, result });
		} catch (error: any) {
			res.status(500).json({ success: false, error: 'Failed to fetch backup events' });
		}
	}
}
