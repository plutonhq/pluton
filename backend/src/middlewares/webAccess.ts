import type { Request, RequestHandler } from 'express';
import session from 'express-session';
import cors from 'cors';
import type { WebOriginPolicy } from '../utils/webOrigins';
import { requestWebOrigin, sameOriginJson } from '../utils/webOrigins';

export function machineRequest(req: Request) {
	const path = req.originalUrl.split('?')[0];
	const apiKeyRoute =
		(req.method === 'GET' && /^\/api\/(plans|storages|devices)\/?$/i.test(path)) ||
		(req.method === 'POST' && /^\/api\/plans\/?$/i.test(path));
	return (
		/^\/api\/agent(?:\/|$)/i.test(path) ||
		(req.method === 'GET' && /^\/api\/health\/?$/i.test(path)) ||
		(apiKeyRoute &&
			!!req.headers.authorization &&
			!req.headers.cookie &&
			!req.headers.origin &&
			!req.headers['sec-fetch-site'])
	);
}
/** Machine bypass does not authorize anything: existing HMAC/API-key route checks still run. */
export function webAccess(policy: WebOriginPolicy): RequestHandler {
	return (req, res, next) => {
		if (machineRequest(req)) return next();
		const origin = requestWebOrigin(req, policy);
		const safe = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
		if (
			!origin ||
			(req.headers.origin !== undefined && req.headers.origin !== origin) ||
			(!safe && !sameOriginJson(req, policy, false))
		) {
			res.setHeader('Cache-Control', 'no-store');
			res
				.status(403)
				.json({ success: false, error: 'Web requests require an approved same-origin request.' });
			return;
		}
		res.locals.webOrigin = origin;
		next();
	};
}
export function sameOriginCors(policy: WebOriginPolicy) {
	return cors((req, callback) =>
		callback(null, {
			origin:
				req.headers.origin === requestWebOrigin(req as Request, policy)
					? req.headers.origin
					: false,
			credentials: true,
			methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
			exposedHeaders: ['X-App-Version', 'X-Server-OS', 'X-Install-Type', 'X-Setup-Pending'],
		})
	);
}
/** Exposes a fixed approved browser scheme ONLY to express-session's cookie logic.
 * The original req.secure/req.protocol and Agent transport authentication are never rewritten. */
export function originAwareSession(
	policy: WebOriginPolicy,
	options: session.SessionOptions
): RequestHandler {
	const middleware = session({
		...options,
		cookie: { ...options.cookie, httpOnly: true, sameSite: 'lax', path: '/', secure: 'auto' },
	});
	return (req, res, next) => {
		if (machineRequest(req)) return next();
		const origin = requestWebOrigin(req, policy);
		if (!origin) {
			res.status(403).json({ success: false, error: 'Unapproved web origin.' });
			return;
		}
		const facade = new Proxy(req, {
			get(target, key, receiver) {
				return key === 'secure' ? origin.startsWith('https:') : Reflect.get(target, key, receiver);
			},
		});
		middleware(facade, res, error => {
			if (error) return next(error);
			if (req.session.webOrigin && req.session.webOrigin !== origin) {
				req.session.regenerate(failure => {
					if (failure) return next(failure);
					req.session.webOrigin = origin;
					next();
				});
			} else {
				// Anonymous API reads must not allocate a saved session. Controllers bind it when needed.
				if (req.session.totpSecret) req.session.webOrigin = origin;
				next();
			}
		});
	};
}
