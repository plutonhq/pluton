import { Request, Response } from 'express';
import { keyringService, KeyringCredentials } from '../services/KeyringService';
import { configService } from '../services/ConfigService';
import { requiresKeyringSetup, isBinaryMode } from '../utils/installHelpers';
import { initSetup } from '../utils/initSetup';
import { db } from '../db';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

export class SetupController {
	/**
	 * Get the current setup status
	 */
	async getStatus(req: Request, res: Response) {
		try {
			const isSetupPending = configService.isSetupPending();
			const isBinary = isBinaryMode();
			const requiresKeyring = requiresKeyringSetup();

			res.json({
				success: true,
				data: {
					setupPending: isSetupPending,
					isBinary,
					requiresKeyringSetup: requiresKeyring,
					platform: process.platform,
				},
			});
		} catch (error: any) {
			res.status(500).json({
				success: false,
				error: error.message || 'Failed to get setup status',
			});
		}
	}

	/**
	 * Complete the initial setup with credentials
	 * This endpoint stores credentials in the OS keyring and initializes the app
	 */
	async completeSetup(req: Request, res: Response) {
		try {
			// Verify we're in setup pending mode
			if (!configService.isSetupPending()) {
				return res.status(400).json({
					success: false,
					error: 'Setup is not pending. Application is already configured.',
				});
			}

			// Verify we're on a keyring-supported platform
			if (!requiresKeyringSetup()) {
				return res.status(400).json({
					success: false,
					error: 'Keyring setup is only available on Windows and macOS binary installations.',
				});
			}

			const { encryptionKey, userName, userPassword } = req.body;

			// Validate required fields
			if (!encryptionKey || !userName || !userPassword) {
				return res.status(400).json({
					success: false,
					error: 'Missing required fields: encryptionKey, userName, userPassword',
				});
			}

			// Validate encryption key length
			if (encryptionKey.length < 12) {
				return res.status(400).json({
					success: false,
					error: 'Encryption key must be at least 12 characters long',
				});
			}

			// Validate username
			if (userName.length < 1) {
				return res.status(400).json({
					success: false,
					error: 'Username cannot be empty',
				});
			}

			// Validate password
			if (userPassword.length < 1) {
				return res.status(400).json({
					success: false,
					error: 'Password cannot be empty',
				});
			}

			// Store credentials in the OS keyring
			const credentials: KeyringCredentials = {
				ENCRYPTION_KEY: encryptionKey,
				USER_NAME: userName,
				USER_PASSWORD: userPassword,
			};

			const stored = await keyringService.setAllCredentials(credentials);

			if (!stored) {
				return res.status(500).json({
					success: false,
					error: 'Failed to store credentials in the system keyring',
				});
			}

			// Update ConfigService with the new credentials
			configService.completeSetup({
				ENCRYPTION_KEY: encryptionKey,
				USER_NAME: userName,
				USER_PASSWORD: userPassword,
			});

			// Run the initial setup (creates database tables, default settings, etc.)
			await initSetup(db as unknown as BetterSQLite3Database);

			res.json({
				success: true,
				message: 'Setup completed successfully. Credentials stored securely.',
			});
		} catch (error: any) {
			console.error('[SetupController] Setup error:', error);
			res.status(500).json({
				success: false,
				error: error.message || 'Failed to complete setup',
			});
		}
	}

	/**
	 * Check if keyring is available on this system
	 */
	async checkKeyringAvailability(req: Request, res: Response) {
		try {
			const isSupported = keyringService.isPlatformSupported();
			const isAvailable = await keyringService.waitForInitialization();

			res.json({
				success: true,
				data: {
					platformSupported: isSupported,
					keyringAvailable: isAvailable,
					platform: process.platform,
				},
			});
		} catch (error: any) {
			res.status(500).json({
				success: false,
				error: error.message || 'Failed to check keyring availability',
			});
		}
	}
}
