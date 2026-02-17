import { configService } from '../services/ConfigService';
import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';

export class UserController {
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
