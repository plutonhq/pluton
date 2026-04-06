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
		const appSettings = req.body.settings as AppSettings['integration'];
		const integrationType = req.body.type as IntegrationTypes;

		try {
			await this.settingsService.validateIntegration(
				parseInt(req.body.settingsID, 10),
				integrationType,
				req.body.test,
				appSettings
			);
			res
				.status(200)
				.json({ success: true, result: 'Notification Sent Successfully. Integration Validated.' });
			return;
		} catch (error: unknown) {
			res.status(500).json({
				success: false,
				error:
					error instanceof Error
						? error.message
						: `Failed to send test notification using ${integrationType}.`,
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

	async setupTwoFactorAuth(req: Request, res: Response): Promise<void> {
		try {
			// This service method generates the QR code and the temporary secret
			const { qrCodeDataUrl, setupKey, tempSecret } =
				await this.settingsService.setupTwoFactorAuth();

			// SECURELY store the secret on the server in the user's session.
			req.session.totpSecret = tempSecret;

			// Send only the visual parts to the client.
			res.status(200).json({ success: true, result: { qrCodeDataUrl, setupKey } });
		} catch (error: any) {
			res.status(error.statusCode || 500).json({ success: false, error: error.message });
		}
	}

	async finalizeTwoFactorSetup(req: Request, res: Response): Promise<void> {
		const { code } = req.body;
		const settingsId = parseInt(req.params.id, 10);

		// 1. Retrieve the secret from the server-side session.
		const tempSecret = req.session.totpSecret;

		if (!tempSecret) {
			res.status(400).json({
				success: false,
				error: 'Your session has expired. Please start the setup process again.',
			});
			return;
		}

		try {
			// The service method validates the code against the temporary secret
			const { recoveryCodes } = await this.settingsService.finalizeTwoFactorSetup(
				tempSecret,
				code,
				settingsId
			);

			// 2. Clean up the temporary secret from the session.
			delete req.session.totpSecret; // or req.session.destroy();

			// 3. Send back the one-time recovery codes.
			res.status(200).json({ success: true, result: { recoveryCodes } });
		} catch (error: any) {
			// If the code was invalid, the service will throw an error.
			res.status(error.statusCode || 500).json({ success: false, error: error.message });
		}
	}

	async checkLatestVersion(req: Request, res: Response): Promise<void> {
		try {
			const latestVersion = await this.settingsService.checkLatestVersion();
			res.status(200).json({ success: true, result: { latestVersion } });
		} catch (error: any) {
			res.status(error.statusCode || 500).json({ success: false, error: error.message });
		}
	}
}
