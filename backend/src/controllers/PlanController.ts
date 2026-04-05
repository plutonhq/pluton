import { Request, Response } from 'express';
import { NewPlanReq } from '../types/plans';
import { PlanService } from '../services/PlanService';
import { AppError } from '../utils/AppError';

export class PlanController {
	constructor(protected planService: PlanService) {}

	async getPlans(req: Request, res: Response): Promise<void> {
		try {
			const allPlans = await this.planService.getAllPlans();
			res.status(200).json({
				success: true,
				result: allPlans || [],
			});
		} catch (error: unknown) {
			const appError = error as AppError;
			res.status(appError.statusCode || 500).json({
				success: false,
				error: 'Internal Server Error. Details: ' + (appError?.message || 'Unknown Error'),
			});
		}
	}

	async getPlan(req: Request, res: Response): Promise<void> {
		if (!req.params.id) {
			res.status(400).json({ success: false, error: 'Plan ID is required' });
			return;
		}
		try {
			const thePlan = await this.planService.getPlan(req.params.id, true);
			res.status(200).json({
				success: true,
				result: thePlan,
			});
		} catch (error: unknown) {
			const appError = error as AppError;
			res.status(appError.statusCode || 500).json({
				success: false,
				error: appError?.message || 'Internal Server Error',
			});
		}
	}

	async checkActiveBackupsOrRestore(req: Request, res: Response): Promise<void> {
		if (!req.params.id) {
			res.status(400).json({ success: false, error: 'Plan ID is required' });
			return;
		}
		try {
			const type = req.query.type === 'restore' ? 'restore' : 'backup';
			const hasActiveBackup = await this.planService.checkActiveBackupsOrRestore(
				req.params.id,
				type
			);
			res.status(200).json({
				success: true,
				result: hasActiveBackup,
			});
		} catch (error: unknown) {
			const appError = error as AppError;
			res.status(appError.statusCode || 500).json({
				success: false,
				error: 'Internal Server Error. Details: ' + (appError?.message || 'Unknown Error'),
			});
		}
	}

	async createPlan(req: Request, res: Response): Promise<void> {
		const planPayload: undefined | NewPlanReq = req.body;

		try {
			if (
				!planPayload ||
				!planPayload.settings ||
				!planPayload.settings.interval ||
				!planPayload.storage.id ||
				!planPayload.sourceType ||
				!planPayload.sourceConfig
			) {
				res.status(400).json({
					success: false,
					error:
						'Required fields missing: interval, storage Id, sourceId, sourceType, sourceConfig',
				});
				return;
			}

			const plan = await this.planService.createPlan(planPayload);
			res.status(201).json({ success: true, result: plan });
		} catch (error: unknown) {
			const appError = error as AppError;
			res.status(appError.statusCode || 500).json({
				success: false,
				error: appError?.message || 'Failed to create plan',
			});
			return;
		}
	}

	async updatePlan(req: Request, res: Response): Promise<void> {
		const planPayload: undefined | NewPlanReq = req.body.plan;
		try {
			if (!req.params.id) {
				res.status(400).json({
					success: false,
					error: 'Plan ID is required.',
				});
				return;
			}
			if (!planPayload) {
				res.status(400).json({
					success: false,
					error: 'Payload Missing.',
				});
				return;
			}

			const updatedPlan = await this.planService.updatePlan(req.params.id, planPayload);
			res.status(200).json({
				success: true,
				result: updatedPlan,
			});
		} catch (error: unknown) {
			const appError = error as AppError;
			res.status(appError.statusCode || 500).json({
				success: false,
				error: appError?.message || 'Failed to update plan',
			});
		}
	}

	async deletePlan(req: Request, res: Response): Promise<void> {
		try {
			if (!req.params.id) {
				res.status(400).json({
					success: false,
					error: 'Plan ID is required',
				});
				return;
			}
			const removeRemoteData = req.query.removeData ? true : false;
			await this.planService.deletePlan(req.params.id, removeRemoteData);
			res.status(200).json({
				success: true,
				message: 'Plan deleted successfully',
			});
		} catch (error: unknown) {
			const appError = error as AppError;
			res.status(appError.statusCode || 500).json({
				success: false,
				error: appError?.message || 'Failed to delete plan',
			});
		}
	}

	async performBackup(req: Request, res: Response): Promise<void> {
		try {
			if (!req.params.id) {
				res.status(400).json({
					success: false,
					error: 'Plan ID is required',
				});
				return;
			}

			await this.planService.performBackup(req.params.id);
			res.status(200).json({ success: true, message: 'Backup initiated successfully' });
		} catch (error: unknown) {
			const appError = error as AppError;
			res.status(appError.statusCode || 500).json({
				success: false,
				error: appError?.message || 'Failed to initiate backup',
			});
		}
	}

	async pauseBackup(req: Request, res: Response): Promise<void> {
		try {
			if (!req.params.id) {
				res.status(400).json({
					success: false,
					error: 'Plan ID is required',
				});
				return;
			}

			await this.planService.pauseBackup(req.params.id);
			res.status(200).json({ success: true, message: 'Backup paused successfully' });
		} catch (error: unknown) {
			const appError = error as AppError;
			res.status(appError.statusCode || 500).json({
				success: false,
				error: appError.message || 'Failed to pause backup',
			});
		}
	}

	async resumeBackup(req: Request, res: Response): Promise<void> {
		try {
			if (!req.params.id) {
				res.status(400).json({
					success: false,
					error: 'Plan ID is required',
				});
				return;
			}

			await this.planService.resumeBackup(req.params.id);
			res.status(200).json({ success: true, message: 'Backup resumed successfully' });
		} catch (error: unknown) {
			const appError = error as AppError;
			res.status(appError.statusCode || 500).json({
				success: false,
				error: appError.message || 'Failed to pause backup',
			});
		}
	}

	async pruneBackup(req: Request, res: Response): Promise<void> {
		try {
			if (!req.params.id) {
				res.status(400).json({
					success: false,
					error: 'Plan ID is required',
				});
				return;
			}

			const pruneResult = await this.planService.pruneBackups(req.params.id);
			res.status(200).json({ success: true, message: pruneResult || 'Backup pruned successfully' });
		} catch (error: unknown) {
			const appError = error as AppError;
			res.status(appError.statusCode || 500).json({
				success: false,
				error: appError.message || 'Failed to prune backups',
			});
		}
	}

	async unlockRepo(req: Request, res: Response): Promise<void> {
		try {
			if (!req.params.id) {
				res.status(400).json({
					success: false,
					error: 'Plan ID is required',
				});
				return;
			}

			const result = await this.planService.unlockRepo(req.params.id);

			// The result object from the service will determine the response
			res.status(result.success ? 200 : 500).json(result);
		} catch (error: unknown) {
			// This catches errors from planStore (e.g., plan not found)
			const appError = error as AppError;
			res.status(appError.statusCode || 500).json({
				success: false,
				error: appError.message || 'Failed to unlock repository',
			});
		}
	}

	async deleteReplicationStorage(req: Request, res: Response): Promise<void> {
		try {
			if (!req.params.id) {
				res.status(400).json({
					success: false,
					error: 'Plan ID is required',
				});
				return;
			}

			const { storageID, storagePath, removeData, replicationId } = req.body;
			if (!storageID || !storagePath) {
				res.status(400).json({
					success: false,
					error: 'storageID and storagePath are required',
				});
				return;
			}

			const result = await this.planService.deleteReplicationStorage(
				req.params.id,
				storageID,
				storagePath,
				removeData === true,
				replicationId
			);
			res.status(200).json(result);
		} catch (error: unknown) {
			const appError = error as AppError;
			res.status(appError.statusCode || 500).json({
				success: false,
				error: appError.message || 'Failed to remove replication storage',
			});
		}
	}

	async getLogs(req: Request, res: Response): Promise<void> {
		try {
			if (!req.params.id) {
				res.status(400).json({
					success: false,
					error: 'Plan ID is required',
				});
				return;
			}

			const logs = await this.planService.getPlanLogs(req.params.id);
			res.status(200).json({ success: true, logs });
		} catch (error: unknown) {
			const appError = error as AppError;
			res.status(appError.statusCode || 500).json({
				success: false,
				error: 'Failed to get logs: ' + appError.message,
			});
			return;
		}
	}

	async downloadLogs(req: Request, res: Response): Promise<void> {
		try {
			if (!req.params.id) {
				res.status(400).json({
					success: false,
					error: 'Plan ID is required',
				});
				return;
			}

			const fileStream = await this.planService.downloadPlanLogs(req.params.id);
			res.setHeader('Content-Type', 'text/plain');
			res.setHeader('Content-Disposition', 'attachment; filename="plan.log"');
			fileStream.pipe(res);
		} catch (error: unknown) {
			const appError = error as AppError;
			res.status(appError.statusCode || 500).json({
				success: false,
				error: `Failed to download logs: ${appError.message}`,
			});
		}
	}

	async checkIntegrity(req: Request, res: Response): Promise<void> {
		if (!req.params.id) {
			res.status(400).json({
				success: false,
				error: 'Plan ID is required',
			});
			return;
		}

		try {
			const result = await this.planService.checkIntegrity(req.params.id);
			res.status(result.success ? 200 : 500).json(result);
		} catch (error) {
			console.log('[checkIntegrity] error :', error);
			res.status(500).json({
				success: false,
				error: 'Internal Server Error',
			});
			return;
		}
	}

	async sendTestBackupNotification(req: Request, res: Response): Promise<void> {
		if (
			!req.body.planId ||
			!req.body.notificationCase ||
			!req.body.channelSettings ||
			!req.body.notificationChannel
		) {
			console.log('req.body :', req.body);
			res.status(400).json({
				success: false,
				error: 'Payload Missing.',
			});
			return;
		}

		try {
			const notificationChannel = req.body.notificationChannel as 'slack' | 'discord' | 'webhook';
			await this.planService.sendTestNotification(
				req.body.planId,
				notificationChannel,
				req.body.notificationCase,
				req.body.channelSettings
			);
			res.status(200).json({ success: true, message: 'Test notification sent successfully' });
		} catch (error: unknown) {
			const appError = error as AppError;
			res.status(appError.statusCode || 500).json({
				success: false,
				error: appError?.message || 'Failed to send test notification',
			});
		}
	}
}
