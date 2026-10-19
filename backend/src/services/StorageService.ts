import path from 'path';
import { Storage, storageInsertSchema, storageUpdateSchema } from '../db/schema/storages';
import { providers } from '../utils/providers';
import { PlanStore } from '../stores/PlanStore';
import { StorageStore } from '../stores/StorageStore';
import { SettingsStore } from '../stores/SettingsStore';
import { resolveSelfBackup } from '../utils/selfBackup/settings';
import Cryptr from 'cryptr';
import { BaseStorageManager } from '../managers/BaseStorageManager';
import {
	RemoteStrategy as RemoteSystemStrategy,
	LocalStrategy as LocalSystemStrategy,
	SystemStrategy,
} from '../strategies/system';
import { generateUID, normalizeStorageName } from '../utils/helpers';
import { sanitizeStoragePath } from '../utils/sanitizeStoragePath';
import { BaseSystemManager } from '../managers/BaseSystemManager';
import { configService } from './ConfigService';
import { AppError, NotFoundError } from '../utils/AppError';
import {
	decryptStorageCredentials,
	isHcpMode,
	isS3Storage,
	publicStorage,
	S3_SECRET_FIELDS,
	splitStorageSecrets,
	validateHcpConfiguration,
} from '../utils/storageSecurity';
import {
	spawnRcloneAuthorize,
	RcloneAuthSession,
	RcloneAuthSessionStatus,
	rcloneLsJson,
	rcloneErrorMessage,
} from '../utils/rclone/helpers';

export interface StorageBrowseItem {
	name: string;
	path: string;
	type: 'directory' | 'file';
	isDirectory: boolean;
	size: number;
	modifiedAt: string;
	owner: string;
	permissions: string;
}

export interface ResolvedStorageTarget {
	storage: Storage;
	remote: string;
	isLocal: boolean;
	cleaned: string;
	target: string;
}

/**
 * A class for managing storage operations.
 */
export class StorageService {
	constructor(
		protected storageManager: BaseStorageManager,
		protected systemManager: BaseSystemManager,
		protected storageStore: StorageStore,
		protected planStore: PlanStore,
		protected settingsStore: SettingsStore
	) {}

	getSystemStrategy(deviceId: string): SystemStrategy {
		const isRemote = deviceId !== 'main';
		return isRemote
			? new RemoteSystemStrategy(deviceId)
			: new LocalSystemStrategy(this.systemManager);
	}

	async getStorages(): Promise<Storage[] | null> {
		const storages = await this.storageStore.getAll(true, true);
		return storages?.map(storage => publicStorage(storage)) || null;
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
			if (isS3Storage(storage.type)) {
				for (const key of S3_SECRET_FIELDS)
					if (!decryptedCreds[key] && storage.settings?.[key])
						decryptedCreds[key] = String(storage.settings[key]);
			}
			const authTypes = providers[storage.type as string].authTypes;
			return {
				...publicStorage(storage, decryptedCreds),
				credentials: isS3Storage(storage.type)
					? Object.fromEntries(
							Object.entries(decryptedCreds).filter(([key]) => !S3_SECRET_FIELDS.has(key))
						)
					: decryptedCreds,
				authTypes,
			};
		} catch (error: any) {
			throw new AppError(
				500,
				'Could not decrypt your Storage Credentials Settings. Your Pluton Secret key may have changed or missing.'
			);
		}
	}

	/**
	 * Resolves a storage id plus a user-supplied path into an rclone target.
	 * The path is sanitized here, so callers never build a target from raw input.
	 */
	protected async resolveStorageTarget(
		id: string,
		requestedPath: string
	): Promise<ResolvedStorageTarget> {
		const storage = await this.storageStore.getById(id);
		if (!storage) {
			throw new NotFoundError('Storage not found');
		}

		const remote = storage.id === 'local' ? 'local' : normalizeStorageName(storage.name);
		const isLocal = storage.type === 'local';
		const trimmed = (requestedPath || '').trim();

		if (isLocal) {
			this.assertLocalBrowseAllowed(trimmed);
			if (!trimmed) {
				throw new AppError(400, 'A folder path is required to browse the local storage.');
			}
		}

		const cleaned = trimmed
			? sanitizeStoragePath(trimmed, storage.type as string).replace(/\\/g, '/')
			: '';

		return { storage, remote, isLocal, cleaned, target: `${remote}:${cleaned}` };
	}

	/**
	 * The local storage reads the host filesystem, so it obeys the same file browser
	 * limits as the device browser.
	 */
	protected assertLocalBrowseAllowed(requestedPath: string): void {
		if (configService.config.ALLOW_FILE_BROWSER === false) {
			throw new AppError(403, 'File browser is disabled');
		}

		const browserRoot = configService.config.FILE_BROWSER_ROOT;
		if (browserRoot && requestedPath) {
			const resolved = path.resolve(requestedPath);
			const resolvedRoot = path.resolve(browserRoot);
			if (!resolved.startsWith(resolvedRoot)) {
				throw new AppError(403, 'Access denied: path outside allowed root');
			}
		}
	}

	async browseStorage(
		id: string,
		requestedPath: string
	): Promise<{ path: string; items: StorageBrowseItem[] }> {
		const storage = await this.storageStore.getById(id);
		if (!storage) {
			throw new NotFoundError('Storage not found');
		}

		// The local storage has no bucket to list, so an empty path means the host's drives.
		if (storage.type === 'local' && !(requestedPath || '').trim()) {
			this.assertLocalBrowseAllowed('');
			const response = await this.getSystemStrategy('main').getBrowsePath('');
			if (!response.success) {
				throw new AppError(500, 'Failed to read the local drives');
			}
			const result = response.result as unknown as { path: string; items: StorageBrowseItem[] };
			return { path: '', items: result.items || [] };
		}

		const { cleaned, target } = await this.resolveStorageTarget(id, requestedPath);

		let entries;
		try {
			entries = await rcloneLsJson(target);
		} catch (error: any) {
			throw new AppError(400, rcloneErrorMessage(error) || 'Failed to read this storage.');
		}
		const items: StorageBrowseItem[] = entries.map(entry => ({
			name: entry.Name,
			path: cleaned ? `${cleaned}/${entry.Path}` : entry.Path,
			type: entry.IsDir ? 'directory' : 'file',
			isDirectory: entry.IsDir,
			size: entry.Size < 0 ? 0 : entry.Size,
			modifiedAt: entry.ModTime || '',
			owner: '',
			permissions: '',
		}));

		items.sort((a, b) => {
			if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
			return a.name.localeCompare(b.name);
		});

		return { path: cleaned, items };
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

			const normalized = splitStorageSecrets(
				parsedStorageData.type,
				parsedStorageData.credentials || {},
				parsedStorageData.settings || {}
			);
			parsedStorageData = { ...parsedStorageData, ...normalized };
			const { type, name, authType, credentials, settings, tags } = parsedStorageData;
			validateHcpConfiguration(credentials as Record<string, string>, settings || {});
			const storageName = (name || '').trim();
			if (isHcpMode(settings)) {
				if (!/^[a-zA-Z0-9_-]+$/.test(storageName))
					throw new AppError(
						400,
						'HCP storage names may contain only letters, numbers, underscores and hyphens.'
					);
				const existing = await this.storageStore.getAll();
				if (existing?.some(storage => storage.name.toLowerCase() === storageName.toLowerCase()))
					throw new AppError(409, 'A storage with this remote name already exists.');
			}
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
			return newStorage ? publicStorage(newStorage) : null;
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
			if (isS3Storage(existingStorage.type)) {
				const previous = decryptStorageCredentials(existingStorage);
				const normalized = splitStorageSecrets(
					existingStorage.type,
					parsedStorageData.credentials || {},
					{ ...(existingStorage.settings || {}), ...(parsedStorageData.settings || {}) }
				);
				for (const key of S3_SECRET_FIELDS) {
					if (!normalized.credentials[key] && previous[key])
						normalized.credentials[key] = previous[key];
				}
				const credentials = { ...previous, ...normalized.credentials };
				if (isHcpMode(existingStorage.settings) && !isHcpMode(normalized.settings))
					throw new AppError(
						409,
						'HCP protected storage mode cannot be disabled by an ordinary edit.'
					);
				validateHcpConfiguration(credentials, normalized.settings);
				parsedStorageData = { ...parsedStorageData, credentials, settings: normalized.settings };
			}
			const { authType, credentials, settings, tags } = parsedStorageData;
			const cryptrForBinding = new Cryptr(configService.config.SECRET as string);
			const nextCredentials = Object.fromEntries(
				Object.entries(credentials || {}).map(([key, value]) => [
					key,
					cryptrForBinding.encrypt(String(value)),
				])
			);
			this.storageStore.assertManagedReplicationStorageEditable(id, {
				...existingStorage,
				settings: settings || existingStorage.settings,
				credentials: nextCredentials,
			});
			// Update remote settings of all the sources first
			const devicesWithStorage = (await this.resolveStorageSources(existingStorage.id)).filter(
				sourceId => !isHcpMode(settings) || sourceId === 'main'
			);
			const deviceUpdateResult: Record<
				string,
				{
					success: boolean;
					result: string;
				}
			> = {};
			if (devicesWithStorage.length > 0) {
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
					JSON.stringify(decryptedOldCred) !== JSON.stringify(credentials) || isHcpMode(settings);

				const deviceUpdatePromises = devicesWithStorage.map(async sourceId => {
					const strategy = this.getSystemStrategy(sourceId);
					const protectedType = isHcpMode(settings) || isHcpMode(existingStorage.settings)
						? { _pluton_storage_type: existingStorage.type }
						: {};
					const updateRes = await strategy.updateRemoteStorage(existingStorage.name, {
						new: { ...settings, ...(credsDifferent ? credentials : {}), ...protectedType },
						old: {
							...(existingStorage.settings || {}),
							...(decryptedOldCred && credsDifferent ? decryptedOldCred : {}),
							...protectedType,
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

			return {
				storage: updatedStorage ? publicStorage(updatedStorage) : null,
				devicesUpdated: deviceUpdateResult,
			};
		} catch (error: any) {
			if (error instanceof AppError) {
				throw error;
			}
			throw new AppError(500, error?.message || 'Error updating storage.');
		}
	}

	/**
	 * Resolves which sources hold an rclone config for a storage and therefore
	 * need it re-pushed when the storage is edited.
	 */
	protected async resolveStorageSources(storageId: string): Promise<string[]> {
		const sourceIds = new Set<string>(['main']);
		const plansWithStorage = await this.planStore.getStoragePlans(storageId);
		const replicationSources = await this.storageStore.getReplicationPlanSources(storageId);

		for (const plan of plansWithStorage || []) {
			if (plan.sourceId) sourceIds.add(plan.sourceId);
		}

		// A device that replicates to this storage also holds a config entry for it.
		for (const sourceId of replicationSources) {
			sourceIds.add(sourceId);
		}
		return [...sourceIds];
	}

	async deleteStorage(id: string): Promise<boolean> {
		try {
			const storage = await this.storageStore.getById(id);
			if (!storage) {
				throw new NotFoundError('Storage not found');
			}
			this.storageStore.assertManagedReplicationStorageEditable(id);

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
			// Disallow removing a storage that is used as a source for storage-sync plans.
			// Storage-to-storage sync plans hold the source storage id in `plans.sourceId`.
			const sourcePlans = await this.planStore.getDevicePlans(id);
			if (sourcePlans && sourcePlans.length > 0) {
				const planTitles = sourcePlans.map(p => p.title).join(', ');
				throw new AppError(
					400,
					`This Storage is used as a backup source by the following plans: ${planTitles}. Please remove them before deleting the Storage.`
				);
			}

			const settingsRow = await this.settingsStore.getFirst();
			const selfBackup = resolveSelfBackup(settingsRow?.settings);
			if (selfBackup.enabled && selfBackup.storageId === id) {
				throw new AppError(
					400,
					`This Storage is used by Pluton's self-backup. Please disable self-backup or choose a different storage before deleting it.`
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
