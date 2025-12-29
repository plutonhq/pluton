import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import Cryptr from 'cryptr';
import { appPaths } from '../utils/AppPaths';
import { configService } from '../services/ConfigService';

interface KeyData {
	publicKey: string;
	encryptedPrivateKey: string;
}

class SecurityKeyManager {
	private static instance: SecurityKeyManager;
	private keyData: KeyData | null = null;
	private decryptedPrivateKey: string | null = null;

	private constructor() {
		this.loadKeys();
	}

	public static getInstance(): SecurityKeyManager {
		if (!SecurityKeyManager.instance) {
			SecurityKeyManager.instance = new SecurityKeyManager();
		}
		return SecurityKeyManager.instance;
	}

	public async setupInitialKeys(): Promise<void> {
		const keysPath = path.join(appPaths.getDataDir(), 'keys.json');

		// 1. Check if keys already exist (Optimization)
		try {
			const existingContent = JSON.parse(await fs.readFile(keysPath, 'utf-8'));
			if (existingContent.publicKey && existingContent.encryptedPrivateKey) {
				console.log('[SecurityKeyManager] Keys already exist. Skipping generation.');
				this.keyData = existingContent;
				return;
			}
		} catch (e) {
			// File might not exist or be corrupt, proceed to generate
		}

		console.log('[SecurityKeyManager] Generating new Ed25519 key pair...');
		const keyPair = crypto.generateKeyPairSync('ed25519', {
			privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
			publicKeyEncoding: { type: 'spki', format: 'pem' },
		});

		const cryptr = new Cryptr(configService.config.SECRET);
		const encryptedPrivateKey = cryptr.encrypt(keyPair.privateKey);

		const newKeyData = {
			publicKey: keyPair.publicKey,
			encryptedPrivateKey: encryptedPrivateKey,
		};

		// 2. MERGE with existing data (Crucial to preserve SECRET/APIKEY)
		try {
			let currentFileContent = {};
			try {
				const fileStr = await fs.readFile(keysPath, 'utf-8');
				currentFileContent = JSON.parse(fileStr);
			} catch (e) {
				// File doesn't exist yet, that's fine
			}

			const finalContent = {
				...currentFileContent,
				...newKeyData,
			};

			await fs.writeFile(keysPath, JSON.stringify(finalContent, null, 2), { mode: 0o600 });
			console.log(`[SecurityKeyManager] Cryptographic keys securely stored at ${keysPath}`);

			// Update local state
			this.keyData = finalContent as KeyData; // Cast or update interface
		} catch (error) {
			console.error('[SecurityKeyManager] Error saving keys:', error);
			throw error;
		}
	}

	private async loadKeys(): Promise<void> {
		try {
			const keysPath = path.join(appPaths.getDataDir(), 'keys.json');
			const fileContent = await fs.readFile(keysPath, 'utf-8');
			this.keyData = JSON.parse(fileContent);
		} catch (error) {}
	}

	public getPublicKey(): string | null {
		return this.keyData?.publicKey || null;
	}

	private getPrivateKey(): string {
		if (this.decryptedPrivateKey) {
			return this.decryptedPrivateKey;
		}

		if (!this.keyData) {
			throw new Error('Keys are not loaded.');
		}

		try {
			const cryptr = new Cryptr(configService.config.SECRET);
			this.decryptedPrivateKey = cryptr.decrypt(this.keyData.encryptedPrivateKey);
			return this.decryptedPrivateKey;
		} catch (error) {
			throw new Error('Failed to decrypt private key. The master SECRET may have changed.');
		}
	}

	public signPayload(payload: object): string {
		const privateKey = this.getPrivateKey();
		const dataToSign = Buffer.from(JSON.stringify(payload));
		const signature = crypto.sign(null, dataToSign, privateKey);

		return signature.toString('base64');
	}

	public verifyPayload(payload: object, signature: string, publicKey: string): boolean {
		const dataToVerify = Buffer.from(JSON.stringify(payload));
		const signatureBuffer = Buffer.from(signature, 'base64');

		return crypto.verify(null, dataToVerify, publicKey, signatureBuffer);
	}
}

export const securityKeyManager = SecurityKeyManager.getInstance();
