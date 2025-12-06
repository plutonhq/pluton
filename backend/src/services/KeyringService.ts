import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { isLinuxDesktop, isKeyringPlatform, isBinaryMode } from '../utils/installHelpers';

const SERVICE_NAME = 'Pluton';

// Credential keys stored in the OS keyring
export const KEYRING_KEYS = {
	ENCRYPTION_KEY: 'ENCRYPTION_KEY',
	USER_NAME: 'USER_NAME',
	USER_PASSWORD: 'USER_PASSWORD',
} as const;

export type KeyringKey = (typeof KEYRING_KEYS)[keyof typeof KEYRING_KEYS];

export interface KeyringCredentials {
	ENCRYPTION_KEY: string;
	USER_NAME: string;
	USER_PASSWORD: string;
}

/**
 * Gets the platform-specific keyring package name and node file
 */
function getKeyringPlatformInfo(): { packageName: string; nodeFile: string } | null {
	const platform = os.platform();
	const arch = os.arch();

	if (platform === 'win32' && arch === 'x64') {
		return {
			packageName: '@napi-rs/keyring-win32-x64-msvc',
			nodeFile: 'keyring.win32-x64-msvc.node',
		};
	} else if (platform === 'darwin' && arch === 'x64') {
		return {
			packageName: '@napi-rs/keyring-darwin-x64',
			nodeFile: 'keyring.darwin-x64.node',
		};
	} else if (platform === 'darwin' && arch === 'arm64') {
		return {
			packageName: '@napi-rs/keyring-darwin-arm64',
			nodeFile: 'keyring.darwin-arm64.node',
		};
	} else if (platform === 'linux' && arch === 'x64') {
		return {
			packageName: '@napi-rs/keyring-linux-x64-gnu',
			nodeFile: 'keyring.linux-x64-gnu.node',
		};
	} else if (platform === 'linux' && arch === 'arm64') {
		return {
			packageName: '@napi-rs/keyring-linux-arm64-gnu',
			nodeFile: 'keyring.linux-arm64-gnu.node',
		};
	}

	return null;
}

/**
 * KeyringService provides a secure way to store and retrieve sensitive credentials
 * using the OS-specific credential manager (Windows Credential Manager / macOS Keychain / Linux Secret Service).
 *
 * This is only used for pkg-packaged executables on Windows, macOS, and Linux desktop environments.
 * Note: On Windows Requires C++ Redistributable to be installed.
 * https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist?view=msvc-170#latest-supported-redistributable-version
 */
class KeyringService {
	private static instance: KeyringService;
	private isSupported: boolean = false;
	private Entry: any = null;

	private constructor() {
		this.initializeKeyring();
	}

	/**
	 * Loads the keyring native module for pkg binary mode
	 * The .node file is placed in node_modules/@napi-rs/keyring-<platform>/ alongside the executable
	 */
	private loadKeyringFromExternalPath(): any {
		const platformInfo = getKeyringPlatformInfo();
		if (!platformInfo) {
			throw new Error(`Unsupported platform: ${os.platform()} ${os.arch()}`);
		}

		// In pkg binary mode, native modules are in node_modules next to the executable
		const execDir = path.dirname(process.execPath);
		const nodeFilePath = path.join(
			execDir,
			'node_modules',
			'@napi-rs',
			platformInfo.packageName.replace('@napi-rs/', ''),
			platformInfo.nodeFile
		);

		console.log(`[KeyringService] Loading keyring from: ${nodeFilePath}`);

		// Use createRequire to load the .node file
		const require = createRequire(import.meta.url);
		const nativeModule = require(nodeFilePath);

		return nativeModule;
	}

	/**
	 * Initializes the keyring module if available and supported
	 */
	private async initializeKeyring(): Promise<void> {
		const platform = os.platform();
		const isSupportedPlatform = isKeyringPlatform();

		if (!isSupportedPlatform) {
			this.isSupported = false;
			return;
		}

		try {
			let keyring: any;

			// In pkg binary mode, load from external path
			if (isBinaryMode()) {
				keyring = this.loadKeyringFromExternalPath();
			} else {
				// In development/docker mode, use dynamic import
				keyring = await import('@napi-rs/keyring');
			}

			this.Entry = keyring.Entry;
			this.isSupported = true;
			const envInfo = platform === 'linux' ? ' (Linux desktop)' : '';
			console.log(`[KeyringService] Keyring module loaded successfully${envInfo}`);
		} catch (error) {
			console.log('[KeyringService] Keyring module not available:', error);
			this.isSupported = false;
		}
	}

	/**
	 * Gets the singleton instance of KeyringService
	 */
	public static getInstance(): KeyringService {
		if (!KeyringService.instance) {
			KeyringService.instance = new KeyringService();
		}
		return KeyringService.instance;
	}

	/**
	 * Checks if the keyring is supported on the current platform
	 */
	public isPlatformSupported(): boolean {
		return isKeyringPlatform();
	}

	/**
	 * Checks if the keyring module is loaded and ready
	 */
	public isKeyringAvailable(): boolean {
		return this.isSupported && this.Entry !== null;
	}

	/**
	 * Waits for the keyring to be initialized (async initialization)
	 */
	public async waitForInitialization(): Promise<boolean> {
		// Give some time for async initialization
		if (!this.isSupported && this.Entry === null) {
			await this.initializeKeyring();
		}
		return this.isKeyringAvailable();
	}

	/**
	 * Stores a credential in the OS keyring
	 */
	public async setCredential(key: KeyringKey, value: string): Promise<boolean> {
		if (!(await this.waitForInitialization())) {
			console.error('[KeyringService] Keyring not available');
			return false;
		}

		try {
			const entry = new this.Entry(SERVICE_NAME, key);
			entry.setPassword(value);
			console.log(`[KeyringService] Credential '${key}' stored successfully`);
			return true;
		} catch (error) {
			console.error(`[KeyringService] Failed to store credential '${key}':`, error);
			return false;
		}
	}

	/**
	 * Retrieves a credential from the OS keyring
	 */
	public async getCredential(key: KeyringKey): Promise<string | null> {
		if (!(await this.waitForInitialization())) {
			return null;
		}

		try {
			const entry = new this.Entry(SERVICE_NAME, key);
			const password = entry.getPassword();
			return password || null;
		} catch (error) {
			// Credential not found is not an error, just return null
			return null;
		}
	}

	/**
	 * Deletes a credential from the OS keyring
	 */
	public async deleteCredential(key: KeyringKey): Promise<boolean> {
		if (!(await this.waitForInitialization())) {
			return false;
		}

		try {
			const entry = new this.Entry(SERVICE_NAME, key);
			entry.deletePassword();
			console.log(`[KeyringService] Credential '${key}' deleted successfully`);
			return true;
		} catch (error) {
			console.error(`[KeyringService] Failed to delete credential '${key}':`, error);
			return false;
		}
	}

	/**
	 * Stores all required credentials at once
	 */
	public async setAllCredentials(credentials: KeyringCredentials): Promise<boolean> {
		const results = await Promise.all([
			this.setCredential(KEYRING_KEYS.ENCRYPTION_KEY, credentials.ENCRYPTION_KEY),
			this.setCredential(KEYRING_KEYS.USER_NAME, credentials.USER_NAME),
			this.setCredential(KEYRING_KEYS.USER_PASSWORD, credentials.USER_PASSWORD),
		]);

		return results.every(Boolean);
	}

	/**
	 * Retrieves all credentials from the OS keyring
	 */
	public async getAllCredentials(): Promise<Partial<KeyringCredentials>> {
		const [encryptionKey, userName, userPassword] = await Promise.all([
			this.getCredential(KEYRING_KEYS.ENCRYPTION_KEY),
			this.getCredential(KEYRING_KEYS.USER_NAME),
			this.getCredential(KEYRING_KEYS.USER_PASSWORD),
		]);

		const credentials: Partial<KeyringCredentials> = {};

		if (encryptionKey) credentials.ENCRYPTION_KEY = encryptionKey;
		if (userName) credentials.USER_NAME = userName;
		if (userPassword) credentials.USER_PASSWORD = userPassword;

		return credentials;
	}

	/**
	 * Checks if all required credentials are stored in the keyring
	 */
	public async hasAllCredentials(): Promise<boolean> {
		const credentials = await this.getAllCredentials();
		return !!(
			credentials.ENCRYPTION_KEY &&
			credentials.USER_NAME &&
			credentials.USER_PASSWORD &&
			credentials.ENCRYPTION_KEY.length >= 12
		);
	}

	/**
	 * Deletes all Pluton credentials from the OS keyring
	 */
	public async deleteAllCredentials(): Promise<boolean> {
		const results = await Promise.all([
			this.deleteCredential(KEYRING_KEYS.ENCRYPTION_KEY),
			this.deleteCredential(KEYRING_KEYS.USER_NAME),
			this.deleteCredential(KEYRING_KEYS.USER_PASSWORD),
		]);

		return results.every(Boolean);
	}
}

// Export singleton instance
export const keyringService = KeyringService.getInstance();
