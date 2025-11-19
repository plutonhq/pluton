import { eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm/sql';
import { DatabaseType } from '../db';
import { Settings, NewSettings, settings } from '../db/schema/settings';
import { AppSettings, INTEGRATIONS_AVAILABLE, IntegrationTypes } from '../types/settings';
import { NotificationChannelResolver } from '../notifications/channels/NotificationChannelResolver';

/**
 * SettingsStore is a class for managing application settings records in the database.
 */
export class SettingsStore {
	constructor(private db: DatabaseType) {}

	async getFirst(): Promise<Settings | null> {
		const appSettings = await this.db.query.settings.findFirst();
		if (appSettings?.settings) {
			const processedSettings = await this.decryptIntegrationSecrets(appSettings.settings);
			if (processedSettings) {
				return { ...appSettings, settings: processedSettings };
			}
		}
		return null;
	}

	async getById(settingsId: number): Promise<Settings | null> {
		const appSettings = await this.db.query.settings.findFirst({
			where: eq(settings.id, settingsId),
		});

		if (appSettings?.settings) {
			const processedSettings = await this.decryptIntegrationSecrets(appSettings.settings);
			if (processedSettings) {
				return { ...appSettings, settings: processedSettings };
			}
		}

		return null;
	}

	async create(settingsData: NewSettings): Promise<Settings | null> {
		const result = await this.db.insert(settings).values(settingsData).returning();
		return result[0] || null;
	}

	async update(id: number, updates: AppSettings): Promise<Settings | null> {
		if (updates?.integration) {
			const processedSettings = await this.encryptIntegrationSecrets(updates);
			if (processedSettings?.integration) {
				updates.integration = processedSettings.integration;
			}
			updates.integration = this.setIntegrationConnectedStatus(updates.integration);
		}
		const result = await this.db
			.update(settings)
			.set({ settings: updates, updatedAt: sql`(unixepoch())` })
			.where(eq(settings.id, id))
			.returning();

		return result[0] || null;
	}

	async delete(id: number): Promise<boolean> {
		const result = await this.db.delete(settings).where(eq(settings.id, id));

		return result.changes > 0;
	}

	async decryptIntegrationSecrets(appSettings: AppSettings) {
		const theSettings = { ...appSettings };
		// Decrypt Secret Fields
		if (theSettings?.integration) {
			try {
				theSettings.integration = NotificationChannelResolver.decryptSecrets(
					theSettings.integration
				);
				return theSettings;
			} catch (error: any) {
				console.log('Error decrypting password:', error);
				null;
			}
		}
	}

	async encryptIntegrationSecrets(appSettings: AppSettings) {
		const theSettings = { ...appSettings };
		// Decrypt Secret Fields
		if (theSettings?.integration) {
			try {
				theSettings.integration = NotificationChannelResolver.encryptSecrets(
					theSettings.integration
				);
				return theSettings;
			} catch (error: any) {
				console.log('Error decrypting password:', error);
				false;
			}
		}
	}

	// If all the required fields are not present in the integration config, set connected to false
	private setIntegrationConnectedStatus(
		integration: AppSettings['integration']
	): AppSettings['integration'] {
		const validatedIntegration = { ...integration };

		// Check each integration type
		Object.keys(validatedIntegration).forEach(integrationType => {
			const type = integrationType as IntegrationTypes;
			const integrationConfig = validatedIntegration[type];

			if (integrationConfig) {
				// Access the required fields
				const requiredFields = INTEGRATIONS_AVAILABLE[type].required;
				const integrationName = INTEGRATIONS_AVAILABLE[type].name;

				const hasAllRequiredFields = requiredFields.every(field => {
					const value = integrationConfig[field as keyof typeof integrationConfig] as any; //weird typescript bugfix patch
					return value !== undefined && value !== null && value !== '';
				});

				// Set connected to false if not all required fields are provided
				if (!hasAllRequiredFields) {
					console.log(
						`${integrationName} integration is missing required fields. Setting connected to false.`
					);
					(validatedIntegration as any)[type] = {
						...integrationConfig,
						connected: false,
					};
				}
				// Since ntfy does not have validation, it should be marked connected if required values are provided.
				if (type === 'ntfy' && hasAllRequiredFields) {
					(validatedIntegration as any)[type] = {
						...integrationConfig,
						connected: true,
					};
				}
			}
		});

		return validatedIntegration;
	}
}
