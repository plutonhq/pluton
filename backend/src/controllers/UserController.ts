import Cryptr from 'cryptr';
import * as otpauth from 'otpauth';
import { configService } from '../services/ConfigService';
import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { SettingsService } from '../services/SettingsService';
import crypto from 'crypto';
import { parseWebOrigins, requestWebOrigin, webCookieOptions } from '../utils/webOrigins';

export class UserController {
	constructor(private settingsService: SettingsService) {}
	private async issueLogin(req: Request, res: Response, user: string) {
		const origin = requestWebOrigin(req, parseWebOrigins(configService.config));
		if (!origin) {
			res.status(403).json({ success: false, error: 'Unapproved web origin.' });
			return;
		}
		if (req.session?.regenerate) {
			await new Promise<void>((resolve, reject) =>
				req.session.regenerate(error => (error ? reject(error) : resolve()))
			);
			req.session.webOrigin = origin;
		}
		const sessionDuration = configService.config.SESSION_DURATION || 7;
		const token = jwt.sign({ user, webOrigin: origin }, configService.config.SECRET, {
			expiresIn: `${sessionDuration}d`,
			jwtid: crypto.randomBytes(16).toString('hex'),
		});
		res.cookie('token', token, {
			...webCookieOptions(origin),
			maxAge: sessionDuration * 24 * 60 * 60 * 1000,
		});
		res.status(200).json({ success: true, error: null });
	}
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
			await this.issueLogin(req, res, theUserName);
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

			await this.issueLogin(req, res, 'admin');
		} catch {
			console.error('2FA verification failed. Private error details were not logged.');
			res.status(500).json({ success: false, error: 'An error occurred during verification.' });
		}
	}

	async logoutUser(req: Request, res: Response): Promise<void> {
		const origin = requestWebOrigin(req, parseWebOrigins(configService.config));
		if (!origin) {
			res.status(403).json({ success: false, error: 'Unapproved web origin.' });
			return;
		}
		if (req.session?.destroy)
			await new Promise<void>((resolve, reject) =>
				req.session.destroy(error => (error ? reject(error) : resolve()))
			);
		res.clearCookie('token', webCookieOptions(origin));
		res.clearCookie('connect.sid', webCookieOptions(origin));

		res.status(200).json({
			success: true,
			message: 'Logged out successfully',
		});
	}
}
