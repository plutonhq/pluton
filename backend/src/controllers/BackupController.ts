import { Request, Response } from 'express';
import { BackupService } from '../services/BackupServices';
import { AppError } from '../utils/AppError';
import { RetainedRestoreDependencyError } from '../utils/retainedRestoreDependency';

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
			this.validateDownloadRequest(req);
			const downloadResult = await this.backupService.getBackupDownload(req.params.id);
			if (typeof downloadResult.streamTo === 'function') {
				const request = this.downloadRequest(req, res);
				try {
					await downloadResult.streamTo(res, request.signal, () => {
						res.setHeader('Content-Type', 'application/x-tar');
						res.setHeader(
							'Content-Disposition',
							`attachment; filename="${downloadResult.fileName}"`
						);
						res.setHeader('Cache-Control', 'private, no-store');
					});
					if (!res.destroyed) res.end();
				} catch (error) {
					if (res.headersSent || res.destroyed) {
						if (!res.destroyed) res.destroy(); // never append JSON/provider output to a partial TAR
					} else {
						res.removeHeader('Content-Type');
						res.removeHeader('Content-Disposition');
						res.status(error instanceof AppError ? error.statusCode : 502).json({
							success: false,
							error: error instanceof AppError ? error.message : 'Remote download failed.',
						});
					}
				} finally {
					request.cleanup();
				}
				return;
			}
			const { fileName, fileStream } = downloadResult;

			// Set headers for streaming
			res.setHeader('Content-Type', 'application/x-tar');
			res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
			res.setHeader('Transfer-Encoding', 'chunked');

			// Pipe the stream directly to response
			fileStream.pipe(res);
			return;
		} catch (error: any) {
			res.status(error instanceof AppError ? error.statusCode : 500).json({
				success: false,
				error: error instanceof AppError ? error.message : 'Failed to get Downloaded file.',
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

		const request = this.downloadRequest(req, res);
		try {
			this.validateDownloadRequest(req);
			const replicationId = req.query.replicationId as string | undefined;
			const downloadResult = await this.backupService.generateBackupDownload(
				req.params.id,
				replicationId,
				request.signal
			);

			if (downloadResult?.streaming === true && Object.keys(req.body || {}).length)
				throw new AppError(400, 'Remote downloads support only the complete exact snapshot.');
			if (!res.destroyed) res.status(200).json({ success: true, result: downloadResult });
		} catch (error: any) {
			if (!res.destroyed)
				res.status(error instanceof AppError ? error.statusCode : 500).json({
					success: false,
					error: error instanceof AppError ? error.message : 'Failed to generate Download Link.',
				});
		} finally {
			request.cleanup();
		}
	}

	private validateDownloadRequest(req: Request) {
		// Keep the existing local file-selection shape, never accept client-owned
		// credentials, repository URLs, storage overrides or process/config options.
		const body = req.body;
		if (
			Object.keys(req.query).some(key => key !== 'replicationId') ||
			(body !== undefined &&
				(!body ||
					typeof body !== 'object' ||
					Array.isArray(body) ||
					Object.keys(body).some(key => key !== 'files') ||
					(body.files !== undefined &&
						(!Array.isArray(body.files) ||
							body.files.some((file: unknown) => typeof file !== 'string')))))
		)
			throw new AppError(400, 'Invalid download request.');
	}

	private downloadRequest(req: Request, res: Response) {
		const controller = new AbortController();
		const abort = () => {
			if (!res.writableFinished) controller.abort();
		};
		req.once?.('aborted', abort);
		res.once?.('close', abort);
		if (req.aborted || res.destroyed) controller.abort();
		return {
			signal: controller.signal,
			cleanup: () => {
				req.removeListener?.('aborted', abort);
				res.removeListener?.('close', abort);
			},
		};
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
			res.status(error instanceof AppError ? error.statusCode : 500).json({
				success: false,
				error: error?.message || 'Failed to delete backup',
				...(error instanceof RetainedRestoreDependencyError && { code: error.code }),
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
