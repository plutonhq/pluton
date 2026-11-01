import { Request, Response } from 'express';
import { BackupService } from '../services/BackupServices';
import { SnapshotIndexEntriesQuery } from '../types/snapshotIndex';

export class BackupController {
	constructor(protected backupService: BackupService) {}

	async getBackupDownload(req: Request, res: Response): Promise<void> {
		if (!req.params.id) {
			res.status(400).json({
				success: false,
				error: 'Backup ID is required',
			});
			return;
		}

		try {
			const { fileName, filePath } = await this.backupService.getBackupDownload(req.params.id);

			// dotfiles 'allow': send checks every segment of an absolute path (e.g. ~/.pluton)
			res.download(filePath, fileName, { dotfiles: 'allow' }, (error: any) => {
				if (!error || res.headersSent) return;
				res.status(error.statusCode || error.status || 500).json({
					success: false,
					error: 'Failed to get Downloaded file. ' + (error.message || ''),
				});
			});
			return;
		} catch (error: any) {
			res.status(error.statusCode || 500).json({
				success: false,
				error: 'Failed to get Downloaded file. ' + (error.message || ''),
			});
		}
	}

	async generateBackupDownload(req: Request, res: Response): Promise<void> {
		if (!req.params.id) {
			res.status(400).json({
				success: false,
				error: 'Backup ID is required',
			});
			return;
		}

		try {
			const replicationId = req.query.replicationId as string | undefined;
			const downloadResult = await this.backupService.generateBackupDownload(
				req.params.id,
				replicationId
			);

			res.status(200).json({ success: true, result: downloadResult });
		} catch (error: any) {
			res.status(500).json({
				success: false,
				error: 'Failed to generate Download Link. ' + (error.message || ''),
			});
		}
	}

	async getSnapshotFiles(req: Request, res: Response): Promise<void> {
		if (!req.params.id) {
			res.status(400).json({
				success: false,
				error: 'Backup ID is required',
			});
			return;
		}

		try {
			const replicationId = req.query.replicationId as string | undefined;
			const snapshotFiles = await this.backupService.getSnapshotFiles(req.params.id, replicationId);

			res.status(200).json({ success: true, result: snapshotFiles });
		} catch (error: any) {
			res.status(500).json({
				success: false,
				error: 'Failed to get Snapshot Files. ' + (error.message || ''),
			});
		}
	}

	protected sendIndexError(res: Response, error: any) {
		res.status(error.statusCode || 500).json({
			success: false,
			error: error?.message || 'Failed to read the Snapshot Index',
		});
	}

	async startSnapshotIndex(req: Request, res: Response): Promise<void> {
		try {
			const replicationId = req.query.replicationId as string | undefined;
			const result = await this.backupService.startSnapshotIndex(req.params.id, replicationId);
			res.status(200).json({ success: true, result });
		} catch (error: any) {
			this.sendIndexError(res, error);
		}
	}

	async getSnapshotIndexStatus(req: Request, res: Response): Promise<void> {
		try {
			const replicationId = req.query.replicationId as string | undefined;
			const result = await this.backupService.getSnapshotIndexStatus(req.params.id, replicationId);
			res.status(200).json({ success: true, result });
		} catch (error: any) {
			this.sendIndexError(res, error);
		}
	}

	async getSnapshotIndexEntries(req: Request, res: Response): Promise<void> {
		try {
			const { dir, sort, order, offset, limit, q, replicationId } = req.query;
			const result = await this.backupService.getSnapshotIndexEntries(
				req.params.id,
				replicationId as string | undefined,
				{
					dir: dir as string | undefined,
					sort: sort as SnapshotIndexEntriesQuery['sort'],
					order: order as SnapshotIndexEntriesQuery['order'],
					offset: Number(offset) || 0,
					limit: Number(limit) || undefined,
					q: q as string | undefined,
				}
			);
			res.status(200).json({ success: true, result });
		} catch (error: any) {
			this.sendIndexError(res, error);
		}
	}

	async getSnapshotIndexDirs(req: Request, res: Response): Promise<void> {
		try {
			const { parent, depth, offset, limit, replicationId } = req.query;
			const result = await this.backupService.getSnapshotIndexDirs(
				req.params.id,
				replicationId as string | undefined,
				{
					parent: parent as string | undefined,
					depth: Number(depth) || undefined,
					offset: Number(offset) || 0,
					limit: Number(limit) || undefined,
				}
			);
			res.status(200).json({ success: true, result });
		} catch (error: any) {
			this.sendIndexError(res, error);
		}
	}

	async getSnapshotIndexSelection(req: Request, res: Response): Promise<void> {
		const { includes, excludes } = req.body || {};
		if (!Array.isArray(includes) || !Array.isArray(excludes)) {
			res.status(400).json({ success: false, error: 'includes and excludes are required' });
			return;
		}
		try {
			const result = await this.backupService.getSnapshotIndexSelection(
				req.params.id,
				req.query.replicationId as string | undefined,
				includes,
				excludes
			);
			res.status(200).json({ success: true, result });
		} catch (error: any) {
			this.sendIndexError(res, error);
		}
	}

	async cancelBackupDownload(req: Request, res: Response): Promise<void> {
		if (!req.params.id) {
			res.status(400).json({
				success: false,
				error: 'Backup ID is required',
			});
			return;
		}

		try {
			const downloadResult = await this.backupService.cancelBackupDownload(
				req.query.planId as string,
				req.params.id
			);
			res.status(200).json({ success: true, result: downloadResult });
		} catch (error: any) {
			res.status(500).json({
				success: false,
				error: 'Failed to cancel Download Generation. ' + (error.message || ''),
			});
		}
	}

	async deleteBackup(req: Request, res: Response): Promise<void> {
		try {
			if (!req.params.id) {
				res.status(400).json({
					success: false,
					error: 'Backup ID is required',
				});
				return;
			}
			const removeSnapshot = true; //req.params.rs ? true : false;
			await this.backupService.deleteBackup(req.params.id, removeSnapshot);
			res.status(200).json({ success: true, result: 'Removed' });
		} catch (error: any) {
			res.status(500).json({
				success: false,
				error: error?.message || 'Failed to delete backup',
			});
			return;
		}
	}

	async getBackupProgress(req: Request, res: Response): Promise<void> {
		if (!req.params.id || !req.query.sourceId || !req.query.sourceType) {
			res.status(400).json({
				success: false,
				error: 'Backup ID or Device ID is required',
			});
			return;
		}

		try {
			const progressRes = await this.backupService.getBackupProgress(req.params.id);
			res.status(200).json(progressRes);
		} catch (error: any) {
			res.status(500).json({
				success: false,
				error: error?.message || 'Failed to retrieve Backup Progress',
			});
			return;
		}
	}

	async cancelBackup(req: Request, res: Response): Promise<void> {
		if (!req.params.id || !req.query.planId) {
			res.status(400).json({
				success: false,
				error: 'Backup ID is required',
			});
			return;
		}
		try {
			const cancelResult = await this.backupService.cancelBackup(
				req.query.planId as string,
				req.params.id
			);
			res.status(200).json(cancelResult);
			return;
		} catch (error: any) {
			console.log('[error] cancelBackupRestore :', error);
			res.status(500).json({
				success: false,
				error: error.message || 'Unknown Error',
			});
			return;
		}
	}

	async updateBackup(req: Request, res: Response): Promise<void> {
		if (!req.params.id) {
			res.status(400).json({
				success: false,
				error: 'Backup ID is required',
			});
			return;
		}

		if (!req.body || Object.keys(req.body).length === 0) {
			res.status(400).json({
				success: false,
				error: 'Update data is required',
			});
			return;
		}
		try {
			const updatedBackup = await this.backupService.updateBackup(req.params.id, req.body);
			res.status(200).json({ success: true, result: updatedBackup });
		} catch (error: any) {
			res.status(500).json({
				success: false,
				error: error?.message || 'Failed to update backup',
			});
		}
	}

	async retryFailedReplications(req: Request, res: Response): Promise<void> {
		if (!req.params.id) {
			res.status(400).json({
				success: false,
				error: 'Backup ID is required',
			});
			return;
		}
		try {
			const result = await this.backupService.retryFailedReplications(
				req.params.id,
				req.query.replicationId as string
			);
			res.status(200).json({ success: true, result });
		} catch (error: any) {
			res.status(error.statusCode || 500).json({
				success: false,
				error: error?.message || 'Failed to retry replications',
			});
		}
	}
}
