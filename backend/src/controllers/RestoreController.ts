import { Request, Response } from 'express';
import { RestoreService } from '../services/RestoreService';

type RestorePayload = {
	backupId: string;
	planId: string;
	target: string;
	overwrite?: 'always' | 'if-changed' | 'if-newer' | 'never';
	includes?: string[];
	excludes?: string[];
	delete?: boolean;
};

export class RestoreController {
	constructor(protected restoreService: RestoreService) {}

	async listRestores(req: Request, res: Response): Promise<void> {
		try {
			const result = await this.restoreService.getAllRestores();
			res.json({ success: true, result });
		} catch (error: any) {
			res.status(500).json({ success: false, error: 'Failed to fetch restores' });
		}
	}

	async getRestore(req: Request, res: Response): Promise<void> {
		try {
			if (!req.params.id) {
				res.status(400).json({ success: false, error: 'Restore ID is required' });
			}

			const restore = await this.restoreService.getRestore(req.params.id);
			if (!restore) {
				res.status(404).json({ success: false, error: 'Restore not found' });
				return;
			}
			res.json({ success: true, result: restore });
		} catch (error: any) {
			res.status(500).json({ success: false, error: 'Failed to fetch restore' });
		}
	}

	async getRestoreStats(req: Request, res: Response): Promise<void> {
		try {
			if (!req.params.id) {
				res.status(400).json({ success: false, error: 'Restore ID is required' });
				return;
			}

			const statsRes = await this.restoreService.getRestoreStats(req.params.id);
			if (statsRes.success) {
				res.json({ success: true, result: statsRes.result });
			} else {
				res.status(404).json({
					success: false,
					error: typeof statsRes.result === 'string' ? statsRes.result : 'Restore stats not found',
				});
			}
		} catch (error: any) {
			res.status(500).json({ success: false, error: 'Failed to fetch restore stats' });
		}
	}

	async deleteRestore(req: Request, res: Response): Promise<void> {
		try {
			if (!req.params.id) {
				res.status(400).json({ success: false, error: 'Restore ID is required' });
			}

			await this.restoreService.deleteRestore(req.params.id);
			res.json({ success: true });
		} catch (error: any) {
			res.status(500).json({ success: false, error: 'Failed to delete restore' });
		}
	}

	async performDryRestore(req: Request, res: Response): Promise<void> {
		const restorePayload: undefined | RestorePayload = req.body;

		if (!restorePayload || !restorePayload.backupId || !restorePayload.planId) {
			res.status(400).json({
				success: false,
				error: 'Required fields missing: backupId, planId',
			});
			return;
		}
		try {
			const restoreResult = await this.restoreService.dryRestoreBackup(restorePayload.backupId, {
				target: restorePayload.target,
				overwrite: restorePayload.overwrite as any,
				includes: restorePayload.includes || [],
				excludes: restorePayload.excludes || [],
				delete: restorePayload.delete || false,
			});
			res.status(200).json({
				success: true,
				result: restoreResult,
			});
		} catch (error: any) {
			res.status(500).json({
				success: false,
				error: 'Failed to perform dry restore. ' + (error.message || ''),
			});
		}
	}

	async performRestore(req: Request, res: Response): Promise<void> {
		const restorePayload: undefined | RestorePayload = req.body;

		if (!restorePayload || !restorePayload.backupId || !restorePayload.planId) {
			res.status(400).json({
				success: false,
				error: 'Required fields missing: Backup or Plan Id.',
			});
			return;
		}
		try {
			const restoreResult = await this.restoreService.restoreBackup(restorePayload.backupId, {
				target: restorePayload.target,
				overwrite: restorePayload.overwrite as any,
				includes: restorePayload.includes || [],
				excludes: restorePayload.excludes || [],
				delete: restorePayload.delete || false,
			});

			res.status(200).json({
				success: true,
				result: restoreResult,
			});
		} catch (error: any) {
			res.status(500).json({
				success: false,
				error: 'Failed to restore backup',
			});
		}
	}

	async getRestoreProgress(req: Request, res: Response): Promise<void> {
		if (!req.params.id || !req.query.sourceId || !req.query.sourceType || !req.query.planId) {
			res.status(400).json({
				success: false,
				error: 'Backup, Device or Plan ID is missing',
			});
			return;
		}

		try {
			const progressRes = await this.restoreService.getRestoreProgress(req.params.id);
			res.status(200).json(progressRes);
		} catch (error: any) {
			console.log('error :', error);
			res.status(500).json({
				success: false,
				error: 'Failed to retrieve Backup Progress',
			});
		}
	}

	async cancelRestore(req: Request, res: Response): Promise<void> {
		if (!req.params.id) {
			res.status(400).json({
				success: false,
				error: 'Backup ID or Restore ID is required',
			});
			return;
		}
		try {
			const cancelResult = await this.restoreService.cancelRestore(req.params.id);
			res.status(200).json(cancelResult);
			return;
		} catch (error: any) {
			console.log('[error] cancelBackupRestore :', error);
			res.status(500).json({
				success: false,
				error: 'Failed to cancel Download Generation. ' + (error.message || ''),
			});
		}
	}
}
