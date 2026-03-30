import * as otpauth from 'otpauth';
import qrcode from 'qrcode';
import { createReadStream, constants, ReadStream } from 'fs';
import { readFile, access } from 'fs/promises';
import { Settings, settingsUpdateSchema } from '../db/schema/settings';
import { TestEmailNotification } from '../notifications/templates/email/test-email/TestEmailNotification';
import { SettingsStore } from '../stores/SettingsStore';
import { AppSettings, IntegrationTypes } from '../types/settings';
import { INotificationChannelResolver } from '../types/notifications';
import { NotificationChannelResolver } from '../notifications/channels/NotificationChannelResolver';
import { appPaths } from '../utils/AppPaths';
import { AppError, NotFoundError } from '../utils/AppError';
import Cryptr from 'cryptr';
import { configService } from './ConfigService';
import { createHash, randomBytes } from 'crypto';

/**
 * A class for managing settings operations.
 */
export class SettingsService {
	protected notificationChannelResolver: INotificationChannelResolver = NotificationChannelResolver;
	constructor(protected settingsStore: SettingsStore) {}

	async getMainSettings(): Promise<Settings | null> {
		return await this.settingsStore.getFirst();
	}

	async getSettings(id: number): Promise<Settings | null> {
		return await this.settingsStore.getById(id);
	}

	async updateSettings(id: number, settings: AppSettings): Promise<Settings | null> {
		try {
			// Validate the plan data using the schema
			let parsedSettings = { ...settings };
			try {
				const parsedSettingsEntry = settingsUpdateSchema
					.partial()
					.parse({ settings: parsedSettings });
				console.log('#### parsedSettingsEntry :', parsedSettingsEntry);
				parsedSettings = parsedSettingsEntry.settings as AppSettings;
			} catch (error) {
				console.error('Error parsing settings data:', error);
				throw new AppError(400, 'Invalid settings data provided');
			}
			const updatedSettings = await this.settingsStore.update(id, parsedSettings);

			if (!updatedSettings) {
				throw new AppError(500, 'Failed to update settings');
			}

			return updatedSettings;
		} catch (error: any) {
			if (error instanceof AppError) {
				throw error; // Re-throw as is
			}
			throw new AppError(
				500,
				error?.message || 'An unexpected error occurred while updating settings.'
			);
		}
	}

	async validateIntegration(
		id: number,
		type: IntegrationTypes,
		test: { email: string },
		settings: AppSettings
	): Promise<boolean> {
		const appSettings = settings;

		const integrationType = type;
		appSettings.integration = this.notificationChannelResolver.encryptSecrets(
			appSettings.integration as AppSettings['integration']
		);
		try {
			// First Update the Integration Settings with the provided config
			const updatedSettings = await this.settingsStore.update(id, appSettings);
			if (!updatedSettings) {
				throw new AppError(500, 'Failed to update settings');
			}
			const theAppSettings = updatedSettings.settings as AppSettings;
			const appTitle = theAppSettings?.title || 'Pluton';

			// Send the test email
			const notificationClass = new TestEmailNotification({ integrationType, appTitle });
			const senderChannel = await this.notificationChannelResolver.getChannel(integrationType);
			const sendRes = await senderChannel.send(notificationClass, {
				emails: test.email,
			});
			// console.log('senderChannel :', senderChannel);
			// console.log('sendRes :', integrationType, sendRes);

			// Set the integration status to connected
			if (sendRes.success) {
				if (theAppSettings?.integration?.[integrationType]) {
					theAppSettings.integration[integrationType].connected = true;
				}
				// Update the settings again with the new integration status
				await this.settingsStore.update(id, theAppSettings);
				return true;
			} else {
				throw new AppError(
					500,
					`Failed to send test email using ${integrationType}. Reason: ${sendRes.result}`
				);
			}
		} catch (error: unknown) {
			throw new AppError(
				500,
				error instanceof Error
					? error.message
					: `Failed to send test email using ${integrationType}.`
			);
		}
	}

	async getAppLogs(id: number): Promise<Record<string, any>[]> {
		const logPath = appPaths.getLogsDir();
		const logFilePath = `${logPath}/app.log`;

		try {
			// Read the raw log file
			const rawLogs = await readFile(logFilePath, 'utf-8');

			if (!rawLogs) {
				// This case is unlikely if the file exists, but good practice
				throw new NotFoundError('No logs found');
			}

			// Process the logs
			const logEntries = rawLogs
				.split(/\r?\n/)
				.filter(line => line.trim() !== '')
				.map(line => {
					try {
						const entry = JSON.parse(line);
						if (entry.time) {
							const date = new Date(entry.time);
							entry.formattedTime = date.toLocaleString();
						}
						return entry;
					} catch (e) {
						return { raw: line };
					}
				});
			return logEntries;
		} catch (error: any) {
			if (error.code === 'ENOENT') {
				// If file doesn't exist, throw a clear NotFoundError
				throw new NotFoundError('No logs found for this plan');
			}
			// For any other read error, throw a generic server error
			throw new AppError(500, 'Failed to read logs: ' + error.message);
		}
	}

	async getAppLogsFile(): Promise<ReadStream> {
		const logPath = appPaths.getLogsDir();
		const logFilePath = `${logPath}/app.log`;

		try {
			// Check if file exists
			await access(logFilePath, constants.F_OK);

			// Stream the file directly to the response
			const fileStream = createReadStream(logFilePath);
			return fileStream;
		} catch (error: any) {
			if (error.code === 'ENOENT') {
				throw new NotFoundError('Log file not found');
			}
			throw new AppError(500, `Failed to download logs: ${error.message}`);
		}
	}

	async setupTwoFactorAuth() {
		// 1. Get required info from settings
		const appSettings = await this.getMainSettings();
		if (!appSettings || !appSettings.settings) {
			throw new Error('Application settings not found.');
		}
		const appName = appSettings.settings.title || 'Pluton';
		const userIdentifier = 'admin';

		// 2. Create a new TOTP instance
		const totp = new otpauth.TOTP({
			issuer: appName,
			label: userIdentifier,
			algorithm: 'SHA1',
			digits: 6,
			period: 30,
		});

		const secret = totp.secret.base32;

		const uri = totp.toString();
		const qrCodeDataUrl = await qrcode.toDataURL(uri);

		// Return the secret so the controller can store it in the session
		return { qrCodeDataUrl, setupKey: secret, tempSecret: secret };
	}

	public async finalizeTwoFactorSetup(tempSecret: string, userCode: string, settingsId: number) {
		// 1. Validate the code against the temporary secret
		const totp = new otpauth.TOTP({
			secret: otpauth.Secret.fromBase32(tempSecret), // Load from the temporary secret
			algorithm: 'SHA1',
			digits: 6,
			period: 30,
		});

		const delta = totp.validate({ token: userCode, window: 1 });

		if (delta === null) {
			throw new AppError(400, 'Invalid verification code. Please try again.');
		}

		// 2. Code is valid, proceed to save permanently
		const appSettings = await this.settingsStore.getById(settingsId);
		if (!appSettings || !appSettings.settings) {
			throw new AppError(500, 'Could not retrieve settings to finalize setup.');
		}

		const cryptr = new Cryptr(configService.config.SECRET);
		const encryptedSecret = cryptr.encrypt(tempSecret);

		// 3. Generate and hash recovery codes
		const recoveryCodes = Array.from({ length: 10 }, () =>
			randomBytes(5).toString('hex').toUpperCase()
		);
		const hashedRecoveryCodes = recoveryCodes.map(code =>
			createHash('sha256').update(code).digest('hex')
		);

		const updatedSettings: AppSettings = {
			...appSettings.settings,
			totp: {
				enabled: true,
				secret: encryptedSecret,
				recoveryCodes: hashedRecoveryCodes,
			},
		};

		await this.settingsStore.update(settingsId, updatedSettings);

		// 4. Return the plain-text recovery codes to be shown to the user ONCE
		return { recoveryCodes };
	}
}
