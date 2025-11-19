import { Request, Response } from 'express';
import { SettingsService } from '../services/SettingsService';
import { AppSettings, IntegrationTypes } from '../types/settings';

export class SettingsController {
	constructor(protected settingsService: SettingsService) {}

	async getMainSettings(req: Request, res: Response): Promise<void> {
		try {
			const appSettings = await this.settingsService.getMainSettings();
			res.status(appSettings ? 200 : 404).json({
				success: true,
				result: appSettings,
			});
			return;
		} catch (error: any) {
			res.status(500).json({
				success: false,
				error: "couldn't Retrieve App settings.",
			});
		}
	}

	async getSettings(req: Request, res: Response): Promise<void> {
		if (!req.params.id) {
			res.status(400).json({
				success: false,
				error: 'Settings ID is required',
			});
			return;
		}

		try {
			const appSettings = await this.settingsService.getSettings(parseInt(req.params.id, 10));
			res.status(appSettings ? 200 : 404).json({
				success: true,
				result: appSettings,
			});
		} catch (error: any) {
			res.status(500).json({
				success: false,
				error: "couldn't Retrieve settings for the given ID.",
			});
		}
	}

	async updateSettings(req: Request, res: Response): Promise<void> {
		if (!req.params.id || !req.body.settings) {
			res.status(400).json({
				success: false,
				error: 'Settings ID or Settings Data Missing',
			});
			return;
		}
		const appSettings = req.body.settings as AppSettings;

		try {
			const updatedSettings = await this.settingsService.updateSettings(
				parseInt(req.params.id, 10),
				appSettings
			);
			res.status(updatedSettings ? 200 : 404).json({
				success: true,
				result: updatedSettings,
			});
			return;
		} catch (error: any) {
			res.status(500).json({
				success: false,
				error: error instanceof Error ? error.message : 'Failed to update settings',
			});
			return;
		}
	}

	async validateIntegration(req: Request, res: Response): Promise<void> {
		if (!req.body.settingsID || !req.body.type || !req.body.settings || !req.body.test) {
			console.log('req.body :', req.body);
			res.status(400).json({
				success: false,
				error: 'Integration Payload Missing.',
			});
			return;
		}
		const appSettings = req.body.settings as AppSettings;
		const integrationType = req.body.type as IntegrationTypes;

		try {
			await this.settingsService.validateIntegration(
				parseInt(req.body.settingsID, 10),
				integrationType,
				req.body.test,
				appSettings
			);
			res.status(200).json({ success: true, result: 'Email Sent Successfully' });
			return;
		} catch (error: unknown) {
			res.status(500).json({
				success: false,
				error:
					error instanceof Error
						? error.message
						: `Failed to send test email using ${integrationType}.`,
			});
			return;
		}
	}

	async getAppLogs(req: Request, res: Response): Promise<void> {
		try {
			if (!req.params.id) {
				res.status(400).json({
					success: false,
					error: 'Settings ID is required',
				});
				return;
			}

			const logs = await this.settingsService.getAppLogs(parseInt(req.params.id, 10));
			res.status(200).json({ success: true, result: logs });
			return;
		} catch (error: any) {
			res.status(500).json({
				success: false,
				error: 'Failed to get logs: ' + error.message,
			});
			return;
		}
	}

	async downloadAppLogs(req: Request, res: Response): Promise<void> {
		if (!req.params.id) {
			res.status(400).json({
				success: false,
				error: 'Settings ID is required',
			});
			return;
		}

		try {
			const logFileStream = await this.settingsService.getAppLogsFile();

			// Set headers for file download
			res.setHeader('Content-Type', 'text/plain');
			res.setHeader('Content-Disposition', `attachment; filename="app.log"`);

			// Stream the file directly to the response
			logFileStream.pipe(res);

			// Return nothing as we're handling the response with the stream
			return;
		} catch (error: any) {
			res.status(500).json({
				success: false,
				error: `Failed to download logs: ${error.message}`,
			});
			return;
		}
	}
}
