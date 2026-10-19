import * as otpauth from 'otpauth';
import qrcode from 'qrcode';
import { createReadStream, constants, ReadStream } from 'fs';
import { readFile, access } from 'fs/promises';
import { Settings, settingsUpdateSchema } from '../db/schema/settings';
import { TestEmailNotification } from '../notifications/templates/email/test-email/TestEmailNotification';
import { TestNtfyNotification } from '../notifications/templates/push/test-ntfy/TestNtfyNotification';
import { SettingsStore } from '../stores/SettingsStore';
import { AppSettings, IntegrationTypes } from '../types/settings';
import { INotificationChannelResolver } from '../types/notifications';
import { NotificationChannelResolver } from '../notifications/channels/NotificationChannelResolver';
import { appPaths } from '../utils/AppPaths';
import { selfBackupSettingsSchema } from '../utils/selfBackup/settings';
import { SelfBackupService } from './SelfBackupService';
import { jobQueue } from '../jobs/JobQueue';
import { SELF_BACKUP_JOB_NAME } from '../jobs/systemJobs';
import { AppError, NotFoundError } from '../utils/AppError';
import Cryptr from 'cryptr';
import { configService } from './ConfigService';
import { createHash, randomBytes } from 'crypto';

function settingsView(row: Settings | null): Settings | null {
	if (!row) return null;
	const view = { ...row, settings: JSON.parse(JSON.stringify(row.settings)) } as Settings;
	for (const field of NotificationChannelResolver.secretFields) {
		const [type, key] = field.split('.');
		const integration = (view.settings?.integration as any)?.[type];
		if (integration && key in integration) {
			integration[`${key}Configured`] = !!integration[key];
			integration[key] = '';
		}
	}
	if (view.settings?.totp)
		view.settings.totp = { enabled: !!view.settings.totp.enabled } as AppSettings['totp'];
	return view;
}
function preserveIntegrationSecrets(
	submitted: AppSettings['integration'],
	saved?: AppSettings['integration']
) {
	const result = JSON.parse(JSON.stringify(submitted));
	for (const field of NotificationChannelResolver.secretFields) {
		const [type, key] = field.split('.');
		if (result[type]) {
			if (!result[type][key] && (saved as any)?.[type]?.[key])
				result[type][key] = (saved as any)[type][key];
			delete result[type][`${key}Configured`];
		}
	}
	return result as AppSettings['integration'];
}

/**
 * A class for managing settings operations.
 */
export class SettingsService {
	protected notificationChannelResolver: INotificationChannelResolver = NotificationChannelResolver;
	constructor(
		protected settingsStore: SettingsStore,
		protected selfBackupService: SelfBackupService
	) {}

	async getMainSettings(): Promise<Settings | null> {
		return settingsView(await this.settingsStore.getFirst());
	}

	async getSettings(id: number): Promise<Settings | null> {
		return settingsView(await this.settingsStore.getById(id));
	}

	async updateSettings(id: number, settings: AppSettings): Promise<Settings | null> {
		try {
			// Validate the plan data using the schema
			let parsedSettings = { ...settings };
			try {
				const parsedSettingsEntry = settingsUpdateSchema
					.partial()
					.parse({ settings: parsedSettings });

				parsedSettings = parsedSettingsEntry.settings as AppSettings;
			} catch (error) {
				throw new AppError(400, 'Invalid settings data provided');
			}

			// settingsUpdateSchema treats the settings JSON column as opaque, so the
			// self-backup block is validated separately.
			if (parsedSettings.selfBackup !== undefined) {
				const parsedSelfBackup = selfBackupSettingsSchema.safeParse(parsedSettings.selfBackup);
				if (!parsedSelfBackup.success) {
					throw new AppError(
						400,
						`Invalid Pluton backup settings: ${parsedSelfBackup.error.issues.map(i => i.message).join(', ')}`
					);
				}
				parsedSettings.selfBackup = parsedSelfBackup.data;
			}
			if (parsedSettings.integration || parsedSettings.totp) {
				const saved = await this.settingsStore.getById(id);
				if (parsedSettings.integration)
					parsedSettings.integration = preserveIntegrationSecrets(
						parsedSettings.integration,
						saved?.settings?.integration
					);
				// A public settings view is not authority to replace private 2FA state.
				if (saved?.settings?.totp) parsedSettings.totp = saved.settings.totp;
			}
			const updatedSettings = await this.settingsStore.update(id, parsedSettings);

			if (!updatedSettings) {
				throw new AppError(500, 'Failed to update settings');
			}

			return settingsView(updatedSettings);
		} catch (error: any) {
			if (error instanceof AppError) {
				throw error; // Re-throw as is
			}
			throw new AppError(500, 'An unexpected error occurred while updating settings.');
		}
	}

	async validateIntegration(
		id: number,
		type: IntegrationTypes,
		test: { email?: string; url?: string },
		settings: AppSettings['integration']
	): Promise<boolean> {
		let integrationSettings = settings;
		const integrationType = type;

		if (!integrationSettings[integrationType]) {
			throw new AppError(400, `Integration settings for ${type} are missing.`);
		}

		const currentSettings = await this.settingsStore.getById(id);
		if (!currentSettings?.settings) {
			throw new NotFoundError('Settings not found');
		}
		integrationSettings = preserveIntegrationSecrets(
			integrationSettings,
			currentSettings.settings.integration
		);

		const encryptedIntegration =
			this.notificationChannelResolver.encryptSecrets(integrationSettings);
		try {
			// First Update the Integration Settings with the provided config
			const updatedSettings = await this.settingsStore.update(id, {
				...currentSettings.settings,
				integration: {
					...currentSettings.settings.integration,
					...integrationSettings,
					[integrationType]: encryptedIntegration[integrationType],
				},
			});
			if (!updatedSettings) {
				throw new AppError(500, 'Failed to update settings');
			}
			const theAppSettings = updatedSettings.settings as AppSettings;
			const appTitle = theAppSettings?.title || 'Pluton';
			let sendRes = { success: false, result: '' };

			// Send the test notification
			if (type === 'ntfy') {
				const notificationClass = new TestNtfyNotification({ integrationType, appTitle });
				const senderChannel = await this.notificationChannelResolver.getChannel(integrationType);
				sendRes = await senderChannel.send(notificationClass, {
					url: test.url,
				});
			} else {
				const notificationClass = new TestEmailNotification({ integrationType, appTitle });
				const senderChannel = await this.notificationChannelResolver.getChannel(integrationType);
				sendRes = await senderChannel.send(notificationClass, {
					emails: test.email,
				});
			}

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
					'Failed to send test notification. Check the saved channel and delivery configuration.'
				);
			}
		} catch (error: unknown) {
			if (error instanceof AppError) throw error;
			throw new AppError(
				500,
				'Failed to send test notification. Check the saved channel and delivery configuration.'
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

	async getSelfBackupStatus() {
		return await this.selfBackupService.getStatus();
	}

	async listSelfBackups() {
		return await this.selfBackupService.listBackups();
	}

	async downloadSelfBackup(blobName: string) {
		return await this.selfBackupService.downloadBackup(blobName);
	}

	/**
	 * Queue the run rather than awaiting it: an inline run would block the response for the
	 * whole upload and bypass the job lock. The UI polls the status endpoint.
	 */
	async runSelfBackupNow(): Promise<void> {
		const { enabled } = await this.selfBackupService.getStatus();
		if (!enabled) {
			throw new AppError(400, 'Pluton backup is not enabled.');
		}
		jobQueue.add(SELF_BACKUP_JOB_NAME, { force: true }, 1, 0);
	}

	async checkLatestVersion() {
		// Compatibility endpoint only. No independently trusted fork update feed exists.
		return null;
	}
}
