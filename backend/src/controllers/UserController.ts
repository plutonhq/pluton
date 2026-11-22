import Cryptr from 'cryptr';
import * as otpauth from 'otpauth';
import { configService } from '../services/ConfigService';
import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { SettingsService } from '../services/SettingsService';
import { serverLogger } from '../utils/logger';

const MAX_TOTP_ATTEMPTS = 5;

export class UserController {
	constructor(private settingsService: SettingsService) {}
	async validateUser(req: Request, res: Response): Promise<void> {
		res.status(200).json({ success: true });
	}

	private issueAuthCookie(res: Response, userName: string): void {
		const sessionDuration = configService.config.SESSION_DURATION || 7;
		const token = jwt.sign({ user: userName }, configService.config.SECRET, {
			expiresIn: `${sessionDuration}d`,
		});
		res.cookie('token', token, {
			httpOnly: true,
			sameSite: 'lax',
			maxAge: sessionDuration * 24 * 60 * 60 * 1000,
			secure: configService.config.APP_URL?.startsWith('https'),
		});
	}

	async loginUser(req: Request, res: Response): Promise<void> {
		const { username, password } = req.body;
		if (!username || !password) {
			res.status(401).json({ error: 'Username & Password Missing' });
			return;
		}

		const theUserName = configService.config.USER_NAME;

		if (username === theUserName && configService.verifyPassword(password)) {
			const appSettings = await this.settingsService.getMainSettings();
			const totpConfig = appSettings?.settings?.totp;

			if (!configService.config.DISABLE_2FA && totpConfig?.enabled && totpConfig.secret) {
				// Password is correct, but the session token is only issued after the 2FA step.
				req.session.regenerate(err => {
					if (err) {
						res.status(500).json({ success: false, error: 'Could not start login session.' });
						return;
					}
					req.session.pendingTotpUser = theUserName;
					req.session.totpAttempts = 0;
					res.status(200).json({ success: true, totpRequired: true, error: null });
				});
				return;
			}

			this.issueAuthCookie(res, theUserName);
			res.status(200).json({ success: true, error: null });
			return;
		}

		const error = 'Incorrect Username or Password';
		res.status(401).json({ success: false, error });
		return;
	}

	async verifyTotp(req: Request, res: Response): Promise<void> {
		const { code } = req.body;
		const pendingUser = req.session?.pendingTotpUser;

		if (!pendingUser) {
			res.status(401).json({ success: false, error: 'Login session expired. Please log in again.' });
			return;
		}

		if (!code || typeof code !== 'string') {
			res.status(400).json({ success: false, error: 'Verification code is missing.' });
			return;
		}

		const appSettings = await this.settingsService.getMainSettings();
		const totpConfig = appSettings?.settings?.totp;

		if (!totpConfig || !totpConfig.enabled || !totpConfig.secret) {
			res.status(400).json({ error: '2FA is not enabled for this account.' });
			return;
		}

		try {
			let isValidTotp = false;
			try {
				const cryptr = new Cryptr(configService.config.SECRET);
				const decryptedSecret = cryptr.decrypt(totpConfig.secret);

				const appName = appSettings?.settings?.title || 'Pluton';
				const totp = new otpauth.TOTP({
					issuer: appName,
					label: 'admin',
					secret: otpauth.Secret.fromBase32(decryptedSecret),
					algorithm: 'SHA1',
					digits: 6,
					period: 30,
				});

				// window: 1 allows codes from the previous, current, and next time periods
				isValidTotp = totp.validate({ token: code.trim(), window: 1 }) !== null;
			} catch (error) {
				console.error('Could not decrypt the 2FA secret. Only recovery codes can be used:', error);
			}
			const isValid = isValidTotp || (await this.settingsService.consumeRecoveryCode(code));

			if (!isValid) {
				const attempts = (req.session.totpAttempts || 0) + 1;
				serverLogger.warn(
					{ ip: req.ip, attempt: attempts, serverTime: new Date().toISOString() },
					'2FA verification failed. If valid codes are rejected, check the server clock.'
				);
				if (attempts >= MAX_TOTP_ATTEMPTS) {
					req.session.destroy(() => {
						res.status(401).json({
							success: false,
							error: 'Too many invalid codes. Please log in again.',
						});
					});
					return;
				}
				req.session.totpAttempts = attempts;
				res.status(401).json({ success: false, error: 'Invalid verification code.' });
				return;
			}

			req.session.destroy(() => {
				this.issueAuthCookie(res, pendingUser);
				res.status(200).json({ success: true, error: null });
			});
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
