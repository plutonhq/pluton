import { Storage, storageInsertSchema, storageUpdateSchema } from '../db/schema/storages';
import { providers } from '../utils/providers';
import { PlanStore } from '../stores/PlanStore';
import { StorageStore } from '../stores/StorageStore';
import Cryptr from 'cryptr';
import { BaseStorageManager } from '../managers/BaseStorageManager';
import {
	RemoteStrategy as RemoteSystemStrategy,
	LocalStrategy as LocalSystemStrategy,
	SystemStrategy,
} from '../strategies/system';
import { generateUID } from '../utils/helpers';
import { BaseSystemManager } from '../managers/BaseSystemManager';
import { configService } from './ConfigService';
import { AppError, NotFoundError } from '../utils/AppError';
import {
	spawnRcloneAuthorize,
	RcloneAuthSession,
	RcloneAuthSessionStatus,
} from '../utils/rclone/helpers';

/**
 * A class for managing storage operations.
 */
export class StorageService {
	constructor(
		protected storageManager: BaseStorageManager,
		protected systemManager: BaseSystemManager,
		protected storageStore: StorageStore,
		protected planStore: PlanStore
	) {}

	getSystemStrategy(deviceId: string): SystemStrategy {
		const isRemote = deviceId !== 'main';
		return isRemote
			? new RemoteSystemStrategy(deviceId)
			: new LocalSystemStrategy(this.systemManager);
	}

	async getStorages(): Promise<Storage[] | null> {
		return await this.storageStore.getAll(true, true);
	}

	async getStorage(
		id: string
	): Promise<Storage & { credentials: Record<string, string>; authTypes: string[] }> {
		const storage = await this.storageStore.getById(id);
		if (!storage) {
			throw new NotFoundError('Storage not found');
		}
		const decryptedCreds: Record<string, string> = {};
		try {
			const cryptr = new Cryptr(configService.config.SECRET as string);
			const credsObj = storage.credentials;

			if (credsObj) {
				Object.keys(credsObj).forEach((k: string) => {
					if (typeof credsObj[k] === 'string') {
						decryptedCreds[k] = cryptr.decrypt(credsObj[k]);
					}
				});
			}
			const authTypes = providers[storage.type as string].authTypes;
			return { ...storage, credentials: decryptedCreds, authTypes };
		} catch (error: any) {
			throw new AppError(
				500,
				'Could not decrypt your Storage Credentials Settings. Your Pluton Secret key may have changed or missing.'
			);
		}
	}

	async getAvailableStorageTypes(): Promise<Record<string, any>> {
		const providersWithoutLocal = { ...providers };
		delete providersWithoutLocal['local'];
		const result = Object.keys(providersWithoutLocal).reduce(
			(acc, key) => ({
				...acc,
				[key]: {
					name: providers[key].name,
					authTypes: providers[key].authTypes,
					settings: providers[key].settings,
					doc: providers[key].doc,
				},
			}),
			{}
		);
		return result;
	}

	async createStorage(storagePayload: Partial<Storage>): Promise<Storage | null> {
		// First create the remote storage
		try {
			// Validate the plan data using the schema
			const id = generateUID();
			let parsedStorageData = { ...storagePayload, id };
			try {
				parsedStorageData = storageInsertSchema.parse(parsedStorageData);
			} catch (error) {
				console.error('Error parsing storage data:', error);
				throw new AppError(400, 'Invalid storage configuration provided. Check required fields.');
			}

			const { type, name, authType, credentials, settings, tags } = parsedStorageData;
			const storageName = (name || '').trim();
			// Create the remote storage with rclone
			const remoteResult = await this.storageManager.createRemote(
				type as string,
				storageName,
				authType as string,
				credentials as Record<string, string>,
				settings as Record<string, string>
			);
			if (!remoteResult.success) {
				throw new AppError(500, remoteResult.result || 'Error creating remote storage.');
			}

			// Encrypt Storage Credentials
			const cryptr = new Cryptr(configService.config.SECRET as string);
			const credsObj = credentials as Record<string, string>;
			const encryptedCreds: Record<string, string> = {};
			Object.keys(credsObj).forEach(k => {
				encryptedCreds[k] = cryptr.encrypt(credsObj[k]);
			});

			// Create the storage in the database
			const storageId = generateUID();
			const newStorage = await this.storageStore.create({
				id: storageId,
				name: storageName,
				type: type as string,
				settings: settings as Record<string, string>,
				credentials: encryptedCreds,
				defaultPath: credsObj?.bucket || '/',
				authType: authType as string,
				tags: tags as string[],
			});
			return newStorage;
		} catch (error: any) {
			if (error instanceof AppError) {
				throw error;
			}
			throw new AppError(500, error?.message || 'Error creating storage.');
		}
	}

	async updateStorage(
		id: string,
		storagePayload: Partial<Storage>
	): Promise<{ storage: Storage | null; devicesUpdated: Record<string, any> }> {
		try {
			const existingStorage = await this.storageStore.getById(id);
			if (!existingStorage) {
				throw new NotFoundError('Storage not found');
			}
			// Validate the plan data using the schema
			let parsedStorageData = { ...storagePayload };
			try {
				parsedStorageData = storageUpdateSchema.parse(storagePayload);
			} catch (error) {
				console.error('Error parsing storage data:', error);
				throw new AppError(400, 'Invalid storage data provided');
			}
			const { authType, credentials, settings, tags } = parsedStorageData;
			// Update remote settings of all the devices first
			const devicesWithStorage: string[] = [];
			const plansWithStorage = await this.planStore.getStoragePlans(existingStorage.id);
			const deviceUpdateResult: Record<
				string,
				{
					success: boolean;
					result: string;
				}
			> = {};
			if (plansWithStorage && plansWithStorage.length > 0) {
				plansWithStorage.forEach(async plan => {
					if (plan.sourceId && !devicesWithStorage.includes(plan.sourceId)) {
						devicesWithStorage.push(plan.sourceId);
					}
				});

				//decrypt the existing credentials
				const existingCreds = existingStorage?.credentials;
				const decryptedOldCred: Record<string, string> = {};
				try {
					if (existingCreds) {
						const eCreds = existingCreds as Record<string, string>;
						const cryptr = new Cryptr(configService.config.SECRET as string);
						Object.keys(eCreds || {}).forEach(k => {
							decryptedOldCred[k] = cryptr.decrypt(eCreds[k]);
						});
					}
				} catch (error) {
					console.log('[ERROR] failed to decrypt old config creds :', error);
				}

				// If old creds and new creds are same, no need to send them
				const credsDifferent =
					JSON.stringify(decryptedOldCred) !== JSON.stringify(credentials) ? true : false;

				const deviceUpdatePromises = devicesWithStorage.map(async sourceId => {
					const strategy = this.getSystemStrategy(sourceId);
					const updateRes = await strategy.updateRemoteStorage(existingStorage.name, {
						new: { ...settings, ...(credsDifferent ? credentials : {}) },
						old: {
							...(existingStorage.settings || {}),
							...(decryptedOldCred && credsDifferent ? decryptedOldCred : {}),
						},
					});
					deviceUpdateResult[sourceId] = updateRes;
					return updateRes;
				});

				// Wait for all device updates to complete
				await Promise.all(deviceUpdatePromises);
			}

			// Encrypt Storage Credentials
			const cryptr = new Cryptr(configService.config.SECRET as string);
			const credsObj = credentials as Record<string, string>;
			const encryptedCreds: Record<string, string> = {};
			Object.keys(credsObj).forEach(k => {
				encryptedCreds[k] = cryptr.encrypt(credsObj[k]);
			});

			const updatedStorage = await this.storageStore.update(id, {
				settings: settings as Record<string, string>,
				credentials: encryptedCreds,
				tags: tags as string[],
			});

			return { storage: updatedStorage, devicesUpdated: deviceUpdateResult };
		} catch (error: any) {
			if (error instanceof AppError) {
				throw error;
			}
			throw new AppError(500, error?.message || 'Error updating storage.');
		}
	}

	async deleteStorage(id: string): Promise<boolean> {
		try {
			const storage = await this.storageStore.getById(id);
			if (!storage) {
				throw new NotFoundError('Storage not found');
			}

			const storagePlans = await this.planStore.getStoragePlans(id);
			const replicationPlans = await this.storageStore.getReplicationPlans(id);

			if (storagePlans && storagePlans.length > 0) {
				const planTitles = storagePlans.map(p => p.title).join(', ');
				throw new AppError(
					400,
					`There are Backup Plans dependent on this Storage: ${planTitles}. Please remove them before deleting the Storage.`
				);
			}

			if (replicationPlans.length > 0) {
				const planTitles = replicationPlans.map(p => p.title).join(', ');
				throw new AppError(
					400,
					`This Storage is used as a replication target by the following plans: ${planTitles}. Please remove it from their replication settings before deleting the storage.`
				);
			}

			const remoteResult = await this.storageManager.deleteRemote(storage.name);
			if (!remoteResult.success) {
				throw new AppError(500, remoteResult.result || 'Failed to delete remote storage');
			}

			await this.storageStore.delete(id);

			return true;
		} catch (error: any) {
			if (error instanceof AppError) {
				throw error;
			}
			throw new AppError(500, error?.message || 'Failed to delete storage');
		}
	}

	async verifyStorage(id: string): Promise<string> {
		try {
			const storage = await this.storageStore.getById(id);
			if (!storage) {
				throw new NotFoundError('Storage not found');
			}
			const decryptedCreds: Record<string, string> = {};
			try {
				const cryptr = new Cryptr(configService.config.SECRET as string);
				const credsObj = storage.credentials;

				if (credsObj) {
					Object.keys(credsObj).forEach((k: string) => {
						if (typeof credsObj[k] === 'string') {
							decryptedCreds[k] = cryptr.decrypt(credsObj[k]);
						}
					});
				}
			} catch (error: any) {
				throw new AppError(
					500,
					'Could not decrypt your Storage Credentials Settings. Your Pluton Secret key may have changed or missing.'
				);
			}
			const bucketName = decryptedCreds?.bucket as string;
			const verifyResult = await this.storageManager.verifyRemote(storage.name, bucketName);
			if (!verifyResult.success) {
				throw new AppError(500, verifyResult.result || 'Failed to verify storage');
			}
			return verifyResult.result;
		} catch (error: any) {
			if (error instanceof AppError) {
				throw error;
			}
			throw new AppError(500, error?.message || 'Failed to verify storage');
		}
	}

	// ── OAuth Authorization Session Management ──────────────────────────

	private authSessions = new Map<string, RcloneAuthSession>();
	private readonly AUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

	startAuthorize(storageType: string): string {
		// Validate storage type
		if (!providers[storageType]) {
			throw new AppError(400, `Unknown storage type: ${storageType}`);
		}
		const provider = providers[storageType];
		if (!provider.authTypes?.includes('oauth')) {
			throw new AppError(400, `Storage type "${storageType}" does not support OAuth`);
		}

		// Allow only one concurrent auth session
		for (const [id, session] of this.authSessions) {
			if (session.status === 'pending') {
				throw new AppError(
					409,
					'An authorization session is already in progress. Cancel it first or wait for it to complete.'
				);
			}
		}

		const sessionId = generateUID();
		const session: RcloneAuthSession = {
			id: sessionId,
			storageType,
			status: 'pending',
			startedAt: Date.now(),
		};
		this.authSessions.set(sessionId, session);

		// Spawn rclone authorize in background
		spawnRcloneAuthorize(session, this.AUTH_TIMEOUT_MS);

		return sessionId;
	}

	getAuthorizeStatus(sessionId: string): RcloneAuthSessionStatus {
		const session = this.authSessions.get(sessionId);
		if (!session) {
			throw new AppError(404, 'Authorization session not found');
		}

		const result: RcloneAuthSessionStatus = {
			status: session.status,
		};
		if (session.authUrl) result.authUrl = session.authUrl;
		if (session.token) result.token = session.token;
		if (session.error) result.error = session.error;

		// Clean up completed/errored sessions after they've been read
		if (session.status === 'success' || session.status === 'error') {
			this.authSessions.delete(sessionId);
		}

		return result;
	}

	cancelAuthorize(sessionId: string): void {
		const session = this.authSessions.get(sessionId);
		if (!session) {
			throw new AppError(404, 'Authorization session not found');
		}
		if (session.process && !session.process.killed) {
			session.process.kill();
		}
		this.authSessions.delete(sessionId);
	}
}
