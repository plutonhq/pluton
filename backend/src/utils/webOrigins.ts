import { isIP } from 'net';
import type { Request, CookieOptions } from 'express';

export type WebOriginConfig = { APP_URL?: string; APP_ALLOWED_ORIGINS?: string };
export type WebOriginPolicy = { canonical: string; origins: readonly string[] };
export class WebOriginConfigError extends Error {
	constructor() {
		super(
			'Invalid APP_URL or APP_ALLOWED_ORIGINS. Use explicit, unambiguous HTTP(S) origins without credentials, paths, wildcards or duplicates.'
		);
	}
}
function originUrl(value: string) {
	if (
		typeof value !== 'string' ||
		value.length > 2048 ||
		!/^https?:\/\/[A-Za-z0-9.:[\]-]+\/?$/i.test(value) ||
		value.replace(/\/$/, '').endsWith(':')
	)
		throw new WebOriginConfigError();
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new WebOriginConfigError();
	}
	if (
		!['http:', 'https:'].includes(url.protocol) ||
		!url.hostname ||
		url.username ||
		url.password ||
		url.pathname !== '/' ||
		url.search ||
		url.hash ||
		url.hostname.includes('*')
	)
		throw new WebOriginConfigError();
	return url;
}
function privateHttpHost(host: string) {
	const name = host.replace(/^\[|\]$/g, '').toLowerCase();
	if (name === 'localhost' || name === '::1' || /^(fc|fd)[a-f0-9]*:/.test(name)) return true;
	if (isIP(name) !== 4) return false;
	const [a, b, c] = name.split('.').map(Number);
	// RFC 1918/loopback, plus non-routable documentation ranges for examples/tests.
	return (
		a === 10 ||
		a === 127 ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		(a === 192 && b === 0 && c === 2) ||
		(a === 198 && b === 51 && c === 100) ||
		(a === 203 && b === 0 && c === 113)
	);
}
/** Operator configuration only. Request Host/forwarded headers can never add an origin. */
export function parseWebOrigins(config: WebOriginConfig): WebOriginPolicy {
	const canonical = originUrl(config.APP_URL ?? 'http://localhost:5173').origin;
	if (config.APP_ALLOWED_ORIGINS !== undefined && typeof config.APP_ALLOWED_ORIGINS !== 'string')
		throw new WebOriginConfigError();
	const input = config.APP_ALLOWED_ORIGINS?.trim();
	const extra = input ? input.split(',').map(value => originUrl(value.trim()).origin) : [];
	if (extra.length > 8 || new Set(extra).size !== extra.length) throw new WebOriginConfigError();
	const origins = [...new Set([canonical, ...extra])];
	if (origins.length > 8) throw new WebOriginConfigError();
	const authorities = new Set<string>(),
		schemes = new Map<string, string>();
	for (const value of origins) {
		const url = new URL(value);
		if (
			authorities.has(url.host) ||
			(schemes.has(url.hostname) && schemes.get(url.hostname) !== url.protocol)
		)
			throw new WebOriginConfigError();
		// Legacy single-APP_URL HTTP installs remain supported; dual-origin HTTP is explicit/private.
		if (input && url.protocol === 'http:' && !privateHttpHost(url.hostname))
			throw new WebOriginConfigError();
		authorities.add(url.host);
		schemes.set(url.hostname, url.protocol);
	}
	return { canonical, origins: Object.freeze(origins) };
}
function authority(value: unknown, protocol: string) {
	if (
		typeof value !== 'string' ||
		value.length > 512 ||
		value.endsWith(':') ||
		!/^[A-Za-z0-9.:[\]-]+$/.test(value)
	)
		return null;
	try {
		return new URL(protocol + '//' + value).host;
	} catch {
		return null;
	}
}
/** Fixed, unambiguous approved authority -> browser scheme mapping, including TLS termination.
 * Forwarded headers are consistency checks only; neither they nor req.protocol grant trust. */
export function requestWebOrigin(req: Request, policy: WebOriginPolicy): string | null {
	if (
		req.rawHeaders?.filter(
			(_value, index) => index % 2 === 0 && req.rawHeaders[index].toLowerCase() === 'host'
		).length > 1
	)
		return null;
	const matches = policy.origins.filter(value => {
		const url = new URL(value);
		return authority(req.headers.host, url.protocol) === url.host;
	});
	if (matches.length !== 1) return null;
	const origin = matches[0],
		url = new URL(origin);
	if ((req.socket as { encrypted?: boolean } | undefined)?.encrypted && url.protocol !== 'https:')
		return null;
	const proto = req.headers['x-forwarded-proto'],
		host = req.headers['x-forwarded-host'],
		port = req.headers['x-forwarded-port'];
	if (
		(proto !== undefined && proto !== url.protocol.slice(0, -1)) ||
		(host !== undefined && authority(host, url.protocol) !== url.host) ||
		(port !== undefined && port !== (url.port || (url.protocol === 'https:' ? '443' : '80')))
	)
		return null;
	return origin;
}
export function sameOriginJson(req: Request, policy: WebOriginPolicy, requireJson = true) {
	const effective = requestWebOrigin(req, policy);
	const origin = req.headers.origin;
	const site = req.headers['sec-fetch-site'];
	if (
		!effective ||
		typeof origin !== 'string' ||
		origin !== effective ||
		(site !== undefined && site !== 'same-origin')
	)
		return false;
	const contentType = req.headers['content-type'];
	const hasBody =
		!!req.headers['transfer-encoding'] || Number(req.headers['content-length'] || 0) > 0;
	return (
		(!requireJson && !hasBody && contentType === undefined) ||
		contentType?.split(';')[0].trim().toLowerCase() === 'application/json'
	);
}
export function webCookieOptions(origin: string): CookieOptions {
	return {
		httpOnly: true,
		sameSite: 'lax',
		secure: new URL(origin).protocol === 'https:',
		path: '/',
	};
}
