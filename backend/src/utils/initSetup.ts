import { eq } from 'drizzle-orm';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import si from 'systeminformation';
import { settings } from '../db/schema/settings';
import { AppSettings } from '../types/settings';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { storages } from '../db/schema/storages';
import { BaseStorageManager } from '../managers/BaseStorageManager';
import { getRcloneVersion, getResticVersion } from '../utils/versions';
import { devices } from '../db/schema/devices';
import { configService } from '../services/ConfigService';
import { appPaths } from './AppPaths';
import { securityKeyManager } from '../managers/SecurityKeyManager';

export async function initSetup(db: BetterSQLite3Database) {
	const setupCompletePath = path.join(appPaths.getDataDir(), '.setup_complete');
	console.log('setupCompletePath :', setupCompletePath);

	try {
		await fs.access(setupCompletePath);
		// If access does not throw, file exists. Setup is complete.
		console.log('[INIT] Setup already completed. Skipping.');
		return;
	} catch (error) {
		// File does not exist, proceed with setup.
		console.log('[INIT] First run detected. Starting initial setup...');
		await runInitialSetup(db);
		// Create the lock file to prevent running setup again
		await fs.writeFile(setupCompletePath, new Date().toISOString());
		console.log('[INIT] Initial setup complete.');
	}
}

async function createDefaultSettings(db: BetterSQLite3Database) {
	const getDefaultSettings = await db.select().from(settings).where(eq(settings.id, 1)).get();
	if (!getDefaultSettings) {
		const defaultAppSettings: AppSettings = {
			theme: 'auto',
			admin_email: '',
			integration: {},
			totp: { enabled: false, secret: '', recoveryCodes: [] },
			reporting: {
				emails: [],
				time: '20:00',
				daily: { enabled: false },
				weekly: { enabled: false },
				monthly: { enabled: false },
			},
			title: configService.config.APP_TITLE || 'Pluton',
			description: 'Pluton backup for your data.',
		};
		await db.insert(settings).values({ settings: defaultAppSettings });
	}
}

async function createLocalStorage(db: BetterSQLite3Database) {
	const localStorage = await db.select().from(storages).where(eq(storages.id, 'local')).get();
	if (!localStorage) {
		console.log('Create Local Storage!');
		await db.insert(storages).values({
			id: 'local',
			name: 'Local Storage',
			type: 'local',
			settings: {},
			credentials: {},
			authType: 'none',
			tags: [],
		});
		try {
			console.log('Create Rclone Local Storage!');
			const storageManager = new BaseStorageManager();
			await storageManager.createRemote('local', 'local', 'none', {}, {});
		} catch (error: any) {
			console.log('[Error] creating Local Storage:', error);
		}
	}
}

async function createMainDevice(db: BetterSQLite3Database) {
	const mainDevice = await db.select().from(devices).where(eq(devices.id, 'main')).get();
	if (!mainDevice) {
		const resticVersion = getResticVersion();
		const rcloneVersion = getRcloneVersion();
		const osInfo = await si.osInfo();
		const detailedOS = `${osInfo.distro} ${osInfo.release}`;
		const tempDir = appPaths.getTempDir();
		await db.insert(devices).values({
			id: 'main',
			agentId: 'main',
			name: os.hostname(),
			ip: '127.0.0.1',
			hostname: os.hostname(),
			platform: os.platform(),
			os: detailedOS,
			versions: {
				restic: resticVersion,
				rclone: rcloneVersion,
				agent: '',
			},
			status: 'active',
			lastSeen: new Date(),
			settings: { tempDir },
		});
	}
}

export async function runInitialSetup(db: BetterSQLite3Database) {
	await securityKeyManager.setupInitialKeys();
	await createMainDevice(db);
	await createLocalStorage(db);
	await createDefaultSettings(db);
	// await encryptRcloneConfig(configService.config.ENCRYPTION_KEY as string);
}
