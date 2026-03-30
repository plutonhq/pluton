import Cryptr from 'cryptr';
import * as otpauth from 'otpauth';
import { configService } from '../services/ConfigService';
import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { SettingsService } from '../services/SettingsService';

export class UserController {
	constructor(private settingsService: SettingsService) {}
	async validateUser(req: Request, res: Response): Promise<void> {
		res.status(200).json({ success: true });
	}

	async loginUser(req: Request, res: Response): Promise<void> {
		const { username, password } = req.body;
		if (!username || !password) {
			res.status(401).json({ error: 'Username & Password Missing' });
			return;
		}

		const theUserName = configService.config.USER_NAME;

		if (username === theUserName && configService.verifyPassword(password)) {
			// Express way of setting cookies
			const sessionDuration = configService.config.SESSION_DURATION || 7;
			const token = jwt.sign({ user: theUserName }, configService.config.SECRET, {
				expiresIn: `${sessionDuration}d`,
			});
			res.cookie('token', token, {
				httpOnly: true,
				sameSite: 'lax',
				maxAge: sessionDuration * 24 * 60 * 60 * 1000,
				secure: configService.config.APP_URL?.startsWith('https'),
			});

			res.status(200).json({ success: true, error: null });
			return;
		}

		const error = 'Incorrect Username or Password';
		res.status(401).json({ success: false, error });
		return;
	}

	async verifyTotp(req: Request, res: Response): Promise<void> {
		const { code } = req.body;

		// 1. Fetch settings to get the secret
		// This assumes you have access to settingsService
		const appSettings = await this.settingsService.getMainSettings();
		const totpConfig = appSettings?.settings?.totp;

		if (!totpConfig || !totpConfig.enabled || !totpConfig.secret) {
			res.status(400).json({ error: '2FA is not enabled for this account.' });
			return;
		}

		try {
			// 2. Decrypt the stored secret
			const cryptr = new Cryptr(configService.config.SECRET);
			const decryptedSecret = cryptr.decrypt(totpConfig.secret);

			// 3. Re-create the TOTP instance with the exact same parameters
			const appName = appSettings?.settings?.title || 'Pluton';
			const userIdentifier = 'admin';
			const totp = new otpauth.TOTP({
				issuer: appName,
				label: userIdentifier,
				secret: otpauth.Secret.fromBase32(decryptedSecret),
				algorithm: 'SHA1',
				digits: 6,
				period: 30,
			});

			// 4. Validate the token
			const delta = totp.validate({
				token: code,
				window: 1, // Allows codes from the previous, current, and next time periods
			});

			if (delta === null) {
				// Code is invalid
				res.status(401).json({ success: false, error: 'Invalid verification code.' });
				return;
			}

			// 5. Code is valid! Proceed with login
			// (The JWT generation and cookie setting logic from your original loginUser method goes here)
			const sessionDuration = configService.config.SESSION_DURATION || 7;
			const token = jwt.sign({ user: 'admin' }, configService.config.SECRET, {
				expiresIn: `${sessionDuration}d`,
			});

			res.cookie('token', token, {
				httpOnly: true,
				sameSite: 'lax',
				maxAge: sessionDuration * 24 * 60 * 60 * 1000,
				secure: configService.config.APP_URL?.startsWith('https'),
			});
			res.status(200).json({ success: true, error: null });
		} catch (error) {
			console.error('Error during 2FA verification:', error);
			res.status(500).json({ success: false, error: 'An error occurred during verification.' });
		}
	}

	async logoutUser(req: Request, res: Response): Promise<void> {
		res.clearCookie('token', {
			httpOnly: true,
			sameSite: 'lax',
		});

		res.status(200).json({
			success: true,
			message: 'Logged out successfully',
		});
	}
}
