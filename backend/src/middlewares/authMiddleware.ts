import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import Cookies from 'cookies';
import { configService } from '../services/ConfigService';

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
	const verifiedAPI = req.headers.authorization
		? req.headers.authorization.substring('Bearer '.length) === configService.config.APIKEY
		: false;
	const accessingAllowedRoute =
		req.url &&
		req.method &&
		allowedApiRoutes.includes(`${req.method}:${req.url.replace(/\?(.*)/, '')}`);

	let authorized: string = '';
	if (token && configService.config.SECRET) {
		jwt.verify(token, configService.config.SECRET, err => {
			// console.log(err);
			authorized = err ? 'Not authorized' : 'authorized';
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
