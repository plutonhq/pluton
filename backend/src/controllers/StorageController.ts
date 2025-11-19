import { Request, Response } from 'express';
import { StorageLogger } from '../utils/logger';
import { StorageService } from '../services/StorageService';

export class StorageController {
	constructor(protected storageService: StorageService) {}

	async listStorages(req: Request, res: Response): Promise<void> {
		try {
			const allStorages = await this.storageService.getStorages();
			res.json({ success: true, result: allStorages });
		} catch (error: any) {
			res.status(500).json({ success: false, error: 'Failed to fetch storages' });
		}
	}

	async listAvailableStorageTypes(req: Request, res: Response): Promise<void> {
		try {
			const result = await this.storageService.getAvailableStorageTypes();
			res.json({ success: true, result });
		} catch (error: any) {
			res.status(500).json({ success: false, error: 'Failed to fetch available storages' });
		}
	}

	async getStorage(req: Request, res: Response): Promise<void> {
		try {
			if (!req.params.id) {
				res.status(400).json({ success: false, error: 'Storage ID is required' });
				return;
			}

			const storage = await this.storageService.getStorage(req.params.id);
			res.json({ success: true, result: storage });
		} catch (error: any) {
			const notFound = error?.message.includes('not found');
			res
				.status(notFound ? 404 : 500)
				.json({ success: false, error: error?.message || 'Failed to fetch storage' });
		}
	}

	async createStorage(req: Request, res: Response): Promise<void> {
		try {
			if (!req.body.name || !req.body.type || !req.body.settings || !req.body.credentials) {
				res
					.status(400)
					.json({ success: false, error: 'Name, type, credentials and settings are required' });
				return;
			}
			const newStorage = await this.storageService.createStorage(req.body);
			res.status(201).json({ success: true, result: newStorage });
		} catch (error: any) {
			res.status(500).json({ success: false, error: error?.message || 'Failed to create storage' });
		}
	}

	async updateStorage(req: Request, res: Response): Promise<void> {
		try {
			if (!req.params.id) {
				res.status(400).json({ success: false, error: 'Storage ID is required' });
				return;
			}

			const result = await this.storageService.updateStorage(req.params.id, req.body);

			res.json({
				success: true,
				result,
			});
		} catch (error: any) {
			StorageLogger.error(
				`Error updating storage #${req.params.id}. Reason : ${error?.message.toString() || 'Unknown Error'}`
			);
			res.status(500).json({ success: false, error: 'Failed to update storage' });
		}
	}

	async deleteStorage(req: Request, res: Response): Promise<void> {
		try {
			if (!req.params.id) {
				res.status(400).json({ success: false, error: 'Storage ID is required' });
				return;
			}

			await this.storageService.deleteStorage(req.params.id);

			res.json({ success: true });
		} catch (error: any) {
			StorageLogger.error(
				`Error deleting storage #${req.params.id}. Reason : ${error?.message.toString() || 'Unknown Error'}`
			);
			res.status(500).json({ success: false, error: 'Failed to delete storage' });
		}
	}

	async verifyStorage(req: Request, res: Response): Promise<void> {
		try {
			if (!req.params.id) {
				res.status(400).json({ success: false, error: 'Storage ID is required' });
				return;
			}

			const result = await this.storageService.verifyStorage(req.params.id);
			res.json({ success: true, result });
		} catch (error: any) {
			res.status(500).json({ success: false, error: 'Failed to verify storage' });
		}
	}

	async authorizeStorage(req: Request, res: Response): Promise<void> {
		try {
			if (!req.query.type) {
				res.status(400).json({ success: false, error: 'Storage type is required' });
				return;
			}
			const rcloneAuthResp = await this.storageService.authorizeStorage(req.query.type as string);
			res.status(200).json({ success: true, result: rcloneAuthResp });
		} catch (error: any) {
			res.status(500).json({ success: false, error: 'Failed to authorize storage' });
		}
	}
}
