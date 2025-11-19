import { createReadStream, constants, ReadStream } from 'fs';
import { readFile, access } from 'fs/promises';
import { Settings, settingsUpdateSchema } from '../db/schema/settings';
import { TestEmailNotification } from '../notifications/templates/email/test-email/TestEmailNotification';
import { SettingsStore } from '../stores/SettingsStore';
import { AppSettings, IntegrationTypes } from '../types/settings';
import { NotificationChannelResolver } from '../notifications/channels/NotificationChannelResolver';
import { appPaths } from '../utils/AppPaths';
import { AppError, NotFoundError } from '../utils/AppError';

/**
 * A class for managing settings operations.
 */
export class SettingsService {
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
		appSettings.integration = NotificationChannelResolver.encryptSecrets(
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
			const senderChannel = await NotificationChannelResolver.getChannel(integrationType);
			const sendRes = await senderChannel.send(notificationClass, {
				emails: test.email,
			});

			console.log('sendRes :', sendRes);
			console.log(
				'appSettings?.integration?.[integrationType] :',
				theAppSettings?.integration?.[integrationType]
			);

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
}
