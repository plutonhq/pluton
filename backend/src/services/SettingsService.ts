import * as otpauth from 'otpauth';
import qrcode from 'qrcode';
import { Readable } from 'stream';
import { Settings, settingsUpdateSchema } from '../db/schema/settings';
import { TestEmailNotification } from '../notifications/templates/email/test-email/TestEmailNotification';
import { TestNtfyNotification } from '../notifications/templates/push/test-ntfy/TestNtfyNotification';
import { SettingsStore } from '../stores/SettingsStore';
import { AppSettings, IntegrationTypes } from '../types/settings';
import { INotificationChannelResolver } from '../types/notifications';
import { NotificationChannelResolver } from '../notifications/channels/NotificationChannelResolver';
import { LogQuery, readLogPage, streamLogFiles } from '../utils/logging/LogReader';
import { listLogFiles } from '../utils/logging/logFiles';
import { LogPage } from '../types/plans';
import { selfBackupSettingsSchema } from '../utils/selfBackup/settings';
import { SelfBackupService } from './SelfBackupService';
import { jobQueue } from '../jobs/JobQueue';
import { SELF_BACKUP_JOB_NAME } from '../jobs/systemJobs';
import { AppError, NotFoundError } from '../utils/AppError';
import Cryptr from 'cryptr';
import { configService } from './ConfigService';
import { createHash, randomBytes } from 'crypto';

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
		return await this.settingsStore.getFirst();
	}

	async getSettings(id: number): Promise<Settings | null> {
		return await this.settingsStore.getById(id);
	}

	async updateSettings(id: number, settings: AppSettings): Promise<Settings | null> {
		try {
			// Validate the plan data using the schema
			let parsedSettings = { ...settings };

			// The TOTP secret and recovery codes are only written by the 2FA setup and login flows.
			const storedTotp = (await this.settingsStore.getById(id))?.settings?.totp;
			if (parsedSettings.totp !== undefined || storedTotp) {
				const requestedEnabled = parsedSettings.totp
					? parsedSettings.totp.enabled
					: storedTotp?.enabled;
				parsedSettings.totp = {
					enabled: !!requestedEnabled && !!storedTotp?.secret,
					secret: storedTotp?.secret || '',
					recoveryCodes: storedTotp?.recoveryCodes || [],
				};
			}

			try {
				const parsedSettingsEntry = settingsUpdateSchema
					.partial()
					.parse({ settings: parsedSettings });

				parsedSettings = parsedSettingsEntry.settings as AppSettings;
			} catch (error) {
				console.error('Error parsing settings data:', error);
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
		test: { email?: string; url?: string },
		settings: AppSettings['integration']
	): Promise<boolean> {
		const integrationSettings = settings;
		const integrationType = type;

		if (!integrationSettings[integrationType]) {
			throw new AppError(400, `Integration settings for ${type} are missing.`);
		}

		const currentSettings = await this.settingsStore.getById(id);
		if (!currentSettings?.settings) {
			throw new NotFoundError('Settings not found');
		}

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
					icon: 'https://pluton.b-cdn.net/logo.png',
				});
			} else {
				const notificationClass = new TestEmailNotification({ integrationType, appTitle });
				const senderChannel = await this.notificationChannelResolver.getChannel(integrationType);
				console.log('senderChannel :', senderChannel);
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
					`Failed to send test notification using ${integrationType}. Reason: ${sendRes.result}`
				);
			}
		} catch (error: unknown) {
			throw new AppError(
				500,
				error instanceof Error
					? error.message
					: `Failed to send test notification using ${integrationType}.`
			);
		}
	}

	async getAppLogs(id: number, query: LogQuery = {}): Promise<LogPage> {
		return readLogPage({ prefix: 'app', ...query });
	}

	async getAppLogsFile(from?: number, to?: number): Promise<Readable> {
		if (!listLogFiles('app').length) throw new NotFoundError('Log file not found');
		return streamLogFiles('app', from, to);
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

	/**
	 * Checks a 2FA recovery code and removes it on match, so each code works only once.
	 */
	public async consumeRecoveryCode(code: string): Promise<boolean> {
		const appSettings = await this.settingsStore.getFirst();
		const totp = appSettings?.settings?.totp;
		if (!appSettings || !totp?.recoveryCodes?.length) {
			return false;
		}

		const hashedCode = createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
		if (!totp.recoveryCodes.includes(hashedCode)) {
			return false;
		}

		await this.settingsStore.update(appSettings.id, {
			...appSettings.settings,
			totp: { ...totp, recoveryCodes: totp.recoveryCodes.filter(c => c !== hashedCode) },
		} as AppSettings);
		return true;
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
		try {
			const response = await fetch('https://api.github.com/repos/plutonhq/pluton/releases/latest');
			if (!response.ok) {
				throw new AppError(500, 'Failed to fetch latest version info');
			}
			const data = await response.json();
			const latestVersion = data.tag_name ? data.tag_name.replace(/^pluton-v/, '') : 'Unknown';

			return latestVersion;
		} catch (error: any) {
			throw new AppError(500, error?.message || 'Failed to check latest version');
		}
	}
}
