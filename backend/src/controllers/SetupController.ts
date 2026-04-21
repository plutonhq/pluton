import { Request, Response } from 'express';
import fs from 'fs';
import { configService } from '../services/ConfigService';
import { requiresDesktopSetup, isBinaryMode } from '../utils/installHelpers';
import { writeEncryptionKeyToEnvFile, encEnvFileExists } from '../utils/envFileHelpers';
import { appPaths } from '../utils/AppPaths';
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
			const requiresSetup = requiresDesktopSetup();
			const hasEncEnvFile = encEnvFileExists(appPaths.getDataDir());

			res.json({
				success: true,
				data: {
					setupPending: isSetupPending,
					isBinary,
					requiresSetup,
					requiresKeyringSetup: requiresSetup, // backward compat
					hasEncEnvFile,
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
	 * This endpoint stores the encryption key in pluton.enc.env and
	 * credentials in keys.json, then initializes the app
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

			// Verify we're on a desktop platform (binary install)
			if (!requiresDesktopSetup()) {
				return res.status(400).json({
					success: false,
					error:
						'Desktop setup is only available on Windows, macOS and Linux desktop binary installations.',
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

			// Store encryption key in pluton.enc.env (replaces keyring storage)
			writeEncryptionKeyToEnvFile(appPaths.getDataDir(), encryptionKey);

			// Persist credentials to disk first (idempotent — safe to redo on retry).
			// completeSetup hashes the password, writes keys.json, and updates in-memory
			// config, but we will roll back the in-memory flag if initSetup fails.
			configService.completeSetup({
				ENCRYPTION_KEY: encryptionKey,
				USER_NAME: userName,
				USER_PASSWORD: userPassword,
			});

			// Run the initial setup (creates database tables, default settings, etc.)
			// If this fails, re-mark setup as pending so the wizard can be retried
			// in the same process. The persisted files stay — they're idempotent.
			try {
				await initSetup(db as unknown as BetterSQLite3Database);
			} catch (initError) {
				configService.markSetupPending();
				throw initError;
			}

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
	 * Check if the system is ready for setup (write permissions, etc.)
	 * Previously checked keyring availability; now checks env file writability.
	 * Kept at the same endpoint for backward compatibility.
	 */
	async checkKeyringAvailability(req: Request, res: Response) {
		try {
			const dataDir = appPaths.getDataDir();
			let writable = false;
			try {
				fs.accessSync(dataDir, fs.constants.W_OK);
				writable = true;
			} catch {
				writable = false;
			}

			res.json({
				success: true,
				data: {
					platformSupported: requiresDesktopSetup(),
					keyringAvailable: writable, // backward compat field name
					dataDirWritable: writable,
					platform: process.platform,
				},
			});
		} catch (error: any) {
			res.status(500).json({
				success: false,
				error: error.message || 'Failed to check system availability',
			});
		}
	}
}
