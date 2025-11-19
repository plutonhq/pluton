import Cryptr from 'cryptr';
import { AppSettings, IntegrationTypes, SmtpSettings } from '../../types/settings';
import { SMTPChannel } from './SMTPChannel';
import { getNestedValue, setNestedValue } from '../../utils/helpers';
import { db } from '../../db/index';
import { SettingsStore } from '../../stores/SettingsStore';
import { configService } from '../../services/ConfigService';

export class NotificationChannelResolver {
	static secretFields: string[] = ['smtp.password'];

	static async getChannel(channelType: IntegrationTypes = 'smtp') {
		const settingsStore = new SettingsStore(db);
		const settingsData = await settingsStore.getFirst();
		const integration = settingsData?.settings?.integration;
		const channelConfig = integration?.[channelType];
		if (!integration || !channelConfig) {
			throw new Error(`${channelType} configuration is not available`);
		}
		switch (channelType) {
			case 'smtp':
				return new SMTPChannel(channelConfig as SmtpSettings);
			default:
				return new SMTPChannel(channelConfig as SmtpSettings);
		}
	}

	static encryptSecrets(integration: AppSettings['integration']): AppSettings['integration'] {
		const integrationEncrypted = JSON.parse(JSON.stringify(integration)); // Deep clone
		const cryptr = new Cryptr(configService.config.SECRET);

		this.secretFields.forEach(fieldPath => {
			const value = getNestedValue(integration, fieldPath);
			if (value && typeof value === 'string') {
				if (!this.isAlreadyEncrypted(value, cryptr)) {
					setNestedValue(integrationEncrypted, fieldPath, cryptr.encrypt(value));
				} else {
					setNestedValue(integrationEncrypted, fieldPath, value);
				}
			}
		});

		return integrationEncrypted;
	}

	static decryptSecrets(integration: AppSettings['integration']): AppSettings['integration'] {
		const integrationDecrypted = JSON.parse(JSON.stringify(integration)); // Deep clone
		const cryptr = new Cryptr(configService.config.SECRET);

		this.secretFields.forEach(fieldPath => {
			const value = getNestedValue(integration, fieldPath);
			if (value && typeof value === 'string') {
				try {
					const decryptedValue = cryptr.decrypt(value);
					console.log('[Decrypted]  :', fieldPath, decryptedValue);
					setNestedValue(integrationDecrypted, fieldPath, decryptedValue);
				} catch (error) {
					setNestedValue(integrationDecrypted, fieldPath, value);
				}
			}
		});

		return integrationDecrypted;
	}

	private static isAlreadyEncrypted(value: string, cryptr: Cryptr): boolean {
		try {
			cryptr.decrypt(value);
			return true;
		} catch (error) {
			return false;
		}
	}
}
