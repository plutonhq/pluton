import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import Cookies from 'cookies';
import { configService } from '../services/ConfigService';
import { safeCompare } from '../utils/helpers';
import { parseWebOrigins, requestWebOrigin, webCookieOptions } from '../utils/webOrigins';

const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
	const cookies = new Cookies(req, res);
	const token = cookies && cookies.get('token');

	const allowedApiRoutes = [
		'GET:/api/plans',
		'GET:/api/storages',
		'GET:/api/devices',
		'GET:/api/health',
		'POST:/api/plans',
	];

	const verifiedAPI = safeCompare(
		req.headers.authorization ? req.headers.authorization.substring('Bearer '.length) : '',
		configService.config.APIKEY || ''
	);
	const accessingAllowedRoute =
		req.url &&
		req.method &&
		allowedApiRoutes.includes(`${req.method}:${req.url.replace(/\?(.*)/, '')}`);

	let authorized: string = '';
	if (token && configService.config.SECRET) {
		jwt.verify(token, configService.config.SECRET, (err, decoded) => {
			// console.log(err);
			const originBound =
				typeof decoded === 'object' && decoded !== null && decoded.webOrigin !== undefined;
			const matches =
				!originBound ||
				(typeof decoded.webOrigin === 'string' &&
					decoded.webOrigin === requestWebOrigin(req, parseWebOrigins(configService.config)));
			// Existing unbound signed sessions remain valid until expiry; new sessions are origin-bound.
			authorized = err || !matches ? 'Not authorized' : 'authorized';
			if (
				!err &&
				!originBound &&
				typeof decoded === 'object' &&
				decoded !== null &&
				typeof decoded.user === 'string'
			) {
				const origin = requestWebOrigin(req, parseWebOrigins(configService.config));
				if (origin) {
					// Upgrade legacy cookie flags without extending the signed token's lifetime or rotating a key.
					res.cookie('token', token, {
						...webCookieOptions(origin),
						...(typeof decoded.exp === 'number'
							? { maxAge: Math.max(0, decoded.exp * 1000 - Date.now()) }
							: {}),
					});
				}
			}
		});
	} else if (verifiedAPI && accessingAllowedRoute) {
		authorized = 'authorized';
	} else {
		if (!token) {
			authorized = 'Not authorized';
		}
		if (token && !configService.config.SECRET) {
			authorized = 'Token has not been Setup.';
		}
		if (verifiedAPI && !accessingAllowedRoute) {
			authorized = 'This Route cannot be accessed with API.';
		}
		if (req.headers.authorization && !verifiedAPI) {
			authorized = 'Invalid API Key Provided.';
		}
	}

	if (authorized !== 'authorized') {
		res.status(401).json({ error: authorized });
		return;
	}
	next();
};

export default authMiddleware;
