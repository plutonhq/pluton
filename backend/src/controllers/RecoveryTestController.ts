import type { Request, Response } from 'express';
import type { RecoveryTestService } from '../services/RecoveryTestService';
import { AppError } from '../utils/AppError';
import { parseRecoveryInput } from '../utils/recoveryTestPolicy';
import { recoverySnapshotSelection, recoveryManualSelection } from '../utils/recoveryPreparation';

export class RecoveryTestController {
	constructor(private readonly service: RecoveryTestService) {}
	private async respond(res: Response, action: () => Promise<unknown>, status = 200) {
		try {
			res.status(status).json({ success: true, result: await action() });
		} catch (error) {
			res.status(error instanceof AppError ? error.statusCode : 500).json({
				success: false,
				error: error instanceof AppError ? error.message : 'Recovery testing request failed.',
			});
		}
	}
	async configuration(req: Request, res: Response) {
		await this.respond(res, () => this.service.configuration(req.params.planId));
	}
	async savePolicy(req: Request, res: Response) {
		await this.respond(res, () => this.service.savePolicy(req.params.planId, req.body));
	}
	async saveTarget(req: Request, res: Response) {
		await this.respond(res, () => this.service.saveTarget(req.params.planId, req.body));
	}
	async list(req: Request, res: Response) {
		await this.respond(res, () => this.service.list(req.params.planId));
	}
	async lookup(req: Request, res: Response) {
		await this.respond(res, () => {
			if (
				!req.body ||
				Object.keys(req.body).some(key => key !== 'backupIds') ||
				!Array.isArray(req.body.backupIds) ||
				req.body.backupIds.length > 999 ||
				req.body.backupIds.some(
					(id: unknown) => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id)
				)
			)
				throw new AppError(400, 'Choose valid backup identifiers.');
			return this.service.list(req.params.planId, [...new Set<string>(req.body.backupIds)]);
		});
	}
	async get(req: Request, res: Response) {
		await this.respond(res, () => this.service.get(req.params.planId, req.params.id));
	}
	async run(req: Request, res: Response) {
		await this.respond(
			res,
			async () => {
				if (req.body && Object.keys(req.body).some(key => key !== 'backupId')) {
					const input = parseRecoveryInput(recoveryManualSelection, req.body);
					return this.service.enqueueManual(req.params.planId, input);
				}
				if (
					!req.body ||
					Object.keys(req.body).some(key => key !== 'backupId') ||
					typeof req.body.backupId !== 'string' ||
					!/^[A-Za-z0-9_-]{1,100}$/.test(req.body.backupId)
				)
					throw new AppError(400, 'Choose an exact completed backup.');
				return this.service.enqueue(req.params.planId, req.body.backupId);
			},
			202
		);
	}
	async preparation(req: Request, res: Response) {
		await this.respond(res, () => {
			const input = parseRecoveryInput(recoverySnapshotSelection, req.body);
			return this.service.preparation(req.params.planId, input.backupId, input.snapshotId);
		});
	}
	async databaseRestore(req: Request, res: Response) {
		await this.respond(res, () => {
			parseRecoveryInput(recoverySnapshotSelection, req.body);
			return this.service.databaseRestoreUnavailable(req.params.planId);
		});
	}
	async cancel(req: Request, res: Response) {
		await this.respond(res, () => this.service.cancel(req.params.planId, req.params.id));
	}
}
