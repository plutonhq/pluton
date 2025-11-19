import { Request, Response } from 'express';
import { DeviceService } from '../services/DeviceService';

export class DeviceController {
	constructor(protected deviceService: DeviceService) {}

	async getDevices(req: Request, res: Response): Promise<void> {
		try {
			const devicesRes = await this.deviceService.getDevices();
			res.json({ success: true, result: devicesRes });
		} catch (error: any) {
			res.status(500).json({
				success: false,
				error: 'Failed to fetch devices',
			});
		}
	}

	async getDevice(req: Request, res: Response): Promise<void> {
		try {
			if (!req.params.id) {
				res.status(400).json({
					success: false,
					error: 'Device ID is required',
				});
				return;
			}
			const metrics = req.query.metrics === 'true' ? true : false;
			const deviceRes = await this.deviceService.getDevice(req.params.id, metrics);
			if (!deviceRes.device) {
				res.status(404).json({
					success: false,
					error: 'Device not found',
				});
				return;
			}
			res.status(200).json({
				success: true,
				result: deviceRes,
			});
		} catch (error: any) {
			console.log('error :', error);
			const notFound = error?.message.includes('not found');
			res.status(notFound ? 404 : 500).json({
				success: false,
				error: 'Failed to fetch device',
			});
			return;
		}
	}

	async updateDevice(req: Request, res: Response): Promise<void> {
		try {
			if (!req.params.id) {
				res.status(400).json({
					success: false,
					error: 'Device ID is required',
				});
				return;
			}

			const { name, settings, tags } = req.body;
			const deviceRes = await this.deviceService.updateDevice(req.params.id, {
				name,
				settings,
				tags,
			});

			res.json({ success: true, result: deviceRes });
			return;
		} catch (error: any) {
			res.status(500).json({
				success: false,
				error: error?.message || 'Failed to update device',
			});
			return;
		}
	}

	async getMetrics(req: Request, res: Response): Promise<void> {
		if (!req.params.id) {
			res.status(400).json({
				success: false,
				error: 'Device ID is missing',
			});
			return;
		}
		try {
			const response = await this.deviceService.getMetrics(req.params.id);
			res.json({ success: true, result: response });
		} catch (error: any) {
			res.status(500).json({
				success: false,
				error: error?.message || 'Failed to fetch system metrics',
			});
		}
	}

	async getBrowsePath(req: Request, res: Response): Promise<void> {
		if (!req.params.id) {
			res.status(400).json({
				success: false,
				error: 'Device ID is missing',
			});
			return;
		}
		try {
			const requestedPath = req.query.path ? decodeURIComponent(req.query.path as string) : '';
			const response = await this.deviceService.getBrowsePath(req.params.id, requestedPath);
			res.json(response);
		} catch (error: any) {
			console.log('error :', error);
			res.status(500).json({
				success: false,
				error: error?.message || 'Failed to read directory contents',
			});
		}
	}

	async updateRestic(req: Request, res: Response): Promise<void> {
		if (!req.params.id || !req.query.version) {
			res.status(400).json({
				success: false,
				error: 'Device ID and Restic version is required',
			});
			return;
		}
		try {
			const response = await this.deviceService.updateRestic(
				req.params.id,
				req.query.version as string
			);
			res.json({ success: true, result: response });
		} catch (error: any) {
			res.status(500).json({
				success: false,
				error: error?.message || 'Failed to update restic',
			});
		}
	}

	async updateRclone(req: Request, res: Response): Promise<void> {
		if (!req.params.id || !req.query.version) {
			res.status(400).json({
				success: false,
				error: 'Device ID and Rclone version is required',
			});
			return;
		}
		try {
			const updatedVersion = await this.deviceService.updateRclone(
				req.params.id,
				req.query.version as string
			);
			res.json({ success: true, result: updatedVersion });
		} catch (error: any) {
			res.status(500).json({
				success: false,
				error: error?.message || 'Failed to update rclone',
			});
		}
	}
}
