import { Request, Response } from 'express';
import { AppError } from '../utils/AppError';
import { LegacyRepositoryService } from '../services/LegacyRepositoryService';

export class LegacyRepositoryController {
	constructor(private readonly legacyRepositoryService: LegacyRepositoryService) {}

	async list(req: Request, res: Response): Promise<void> {
		try {
			res.status(200).json({ success: true, result: await this.legacyRepositoryService.getAll() });
		} catch (error) {
			this.respondWithError(res, error);
		}
	}

	async get(req: Request, res: Response): Promise<void> {
		try {
			res.status(200).json({ success: true, result: await this.legacyRepositoryService.getById(req.params.id) });
		} catch (error) {
			this.respondWithError(res, error);
		}
	}

	async create(req: Request, res: Response): Promise<void> {
		try {
			const repository = await this.legacyRepositoryService.register(req.body);
			res.status(201).json({ success: true, result: repository });
		} catch (error) {
			this.respondWithError(res, error);
		}
	}

	async validate(req: Request, res: Response): Promise<void> {
		try {
			const result = await this.legacyRepositoryService.validate(req.params.id);
			res.status(200).json({ success: true, result });
		} catch (error) {
			this.respondWithError(res, error);
		}
	}

	async listSnapshots(req: Request, res: Response): Promise<void> {
		try {
			const filters: Record<string, string> = {};
			for (const name of ['tag', 'path', 'host', 'workload', 'dataset', 'page', 'pageSize']) {
				const value = this.readQueryString(req, name);
				if (value !== undefined) filters[name] = value;
			}
			const result = await this.legacyRepositoryService.listSnapshots(req.params.id, filters);
			res.status(200).json({ success: true, result });
		} catch (error) {
			this.respondWithError(res, error);
		}
	}

	async getSnapshot(req: Request, res: Response): Promise<void> {
		try {
			const result = await this.legacyRepositoryService.getSnapshot(
				req.params.id,
				req.params.snapshotId
			);
			res.status(200).json({ success: true, result });
		} catch (error) {
			this.respondWithError(res, error);
		}
	}

	async getStats(req: Request, res: Response): Promise<void> {
		try {
			const result = await this.legacyRepositoryService.getStats(req.params.id);
			res.status(200).json({ success: true, result });
		} catch (error) {
			this.respondWithError(res, error);
		}
	}

	async listSnapshotDirectory(req: Request, res: Response): Promise<void> {
		try {
			const result = await this.legacyRepositoryService.listSnapshotDirectory(
				req.params.id,
				req.params.snapshotId,
				this.readQueryString(req, 'path') || ''
			);
			res.status(200).json({ success: true, result });
		} catch (error) {
			this.respondWithError(res, error);
		}
	}

	async createRestore(req: Request, res: Response): Promise<void> {
		try {
			const result = await this.legacyRepositoryService.startRestore(req.params.id, req.body);
			res.status(202).json({ success: true, result });
		} catch (error) {
			this.respondWithError(res, error);
		}
	}

	async getRestore(req: Request, res: Response): Promise<void> {
		try {
			const result = await this.legacyRepositoryService.getRestoreJob(req.params.id, req.params.jobId);
			res.status(200).json({ success: true, result });
		} catch (error) {
			this.respondWithError(res, error);
		}
	}

	async cancelRestore(req: Request, res: Response): Promise<void> {
		try {
			const result = await this.legacyRepositoryService.cancelRestore(req.params.id, req.params.jobId);
			res.status(200).json({ success: true, result });
		} catch (error) {
			this.respondWithError(res, error);
		}
	}

	async downloadRestoredFile(req: Request, res: Response): Promise<void> {
		try {
			const download = await this.legacyRepositoryService.openRestoredFile(
				req.params.id,
				req.params.jobId,
				this.readQueryString(req, 'path')
			);
			const asciiFileName = download.fileName.replace(/[^\x20-\x7E]/g, '_');
			res.setHeader('Content-Type', 'application/octet-stream');
			res.setHeader(
				'Content-Disposition',
				`attachment; filename="${asciiFileName}"; filename*=UTF-8''${encodeURIComponent(download.fileName)}`
			);
			res.setHeader('Content-Length', String(download.size));
			const fileStream = download.fileHandle.createReadStream();
			fileStream.on('error', () => {
				if (!res.headersSent) {
					res.status(500).json({ success: false, error: 'Could not stream restored file.' });
				} else {
					res.destroy();
				}
			});
			fileStream.pipe(res);
		} catch (error) {
			this.respondWithError(res, error);
		}
	}

	async delete(req: Request, res: Response): Promise<void> {
		try {
			await this.legacyRepositoryService.deleteRegistration(req.params.id);
			res.status(200).json({
				success: true,
				message: 'Legacy repository registration removed. The repository was not modified.',
			});
		} catch (error) {
			this.respondWithError(res, error);
		}
	}

	private readQueryString(req: Request, name: string): string | undefined {
		const value = req.query[name];
		if (typeof value === 'undefined') return undefined;
		if (typeof value !== 'string') {
			throw new AppError(400, `${name} must be a single text value.`);
		}
		return value;
	}

	private respondWithError(res: Response, error: unknown): void {
		if (error instanceof AppError) {
			res.status(error.statusCode).json({ success: false, error: error.message });
			return;
		}
		res.status(500).json({ success: false, error: 'Internal Server Error' });
	}
}
