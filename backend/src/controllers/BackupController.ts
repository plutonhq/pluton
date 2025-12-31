import { Request, Response } from 'express';
import { BackupService } from '../services/BackupServices';

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
			const downloadResult = await this.backupService.getBackupDownload(req.params.id);
			const { fileName, fileStream } = downloadResult;

			// Set headers for streaming
			res.setHeader('Content-Type', 'application/x-tar');
			res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
			res.setHeader('Transfer-Encoding', 'chunked');

			// Pipe the stream directly to response
			fileStream.pipe(res);

			res;
		} catch (error: any) {
			res.status(500).json({
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
			const downloadResult = await this.backupService.generateBackupDownload(req.params.id);

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
			const snapshotFiles = await this.backupService.getSnapshotFiles(req.params.id);

			res.status(200).json({ success: true, result: snapshotFiles });
		} catch (error: any) {
			res.status(500).json({
				success: false,
				error: 'Failed to get Snapshot Files. ' + (error.message || ''),
			});
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
}
