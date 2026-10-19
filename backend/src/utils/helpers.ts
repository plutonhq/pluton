import { customAlphabet } from 'nanoid';
import { timingSafeEqual } from 'crypto';

export const isDevMode = process.env.NODE_ENV === 'development';

/**
 * Generates a unique 12-character alphanumeric ID using nanoid.
 * @returns A unique string ID
 * @example
 * generateUID(); // 'a1b2c3d4e5f6'
 */
export const generateUID = (length: number = 12) => {
	const nanoid = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', length);
	return nanoid();
};

/**
 * Retrieves a nested value from an object using a dot-separated path string.
 * Returns undefined if the path does not exist.
 *
 * @param obj - The object to query
 * @param path - Dot-separated path string (e.g., 'a.b.c')
 * @returns The value at the specified path, or undefined
 *
 * @example
 * getNestedValue({ a: { b: { c: 5 } } }, 'a.b.c'); // 5
 */
export function getNestedValue(obj: any, path: string): any {
	return path.split('.').reduce((current, key) => {
		return current && current[key] !== undefined ? current[key] : undefined;
	}, obj);
}

/**
 * Sets a nested value in an object using a dot-separated path string.
 * Creates intermediate objects if they do not exist.
 *
 * @param obj - The object to modify
 * @param path - Dot-separated path string (e.g., 'a.b.c')
 * @param value - The value to set at the specified path
 *
 * @example
 * const obj = {};
 * setNestedValue(obj, 'a.b.c', 10);
 * // obj is now { a: { b: { c: 10 } } }
 */
export function setNestedValue(obj: any, path: string, value: any): void {
	const keys = path.split('.');
	const lastKey = keys.pop()!;

	const target = keys.reduce((current, key) => {
		if (!current[key]) {
			current[key] = {};
		}
		return current[key];
	}, obj);

	target[lastKey] = value;
}

/**
 * Canonicalises a storage's display name to its rclone remote name. The built-in
 * local storage is stored as "Local"/"Local Storage" but its remote is "local".
 */
export function normalizeStorageName(name?: string | null): string {
	if (!name) return '';
	return name === 'Local' || name === 'Local Storage' ? 'local' : name;
}

export const safeCompare = (a: string, b: string): boolean => {
	if (a.length !== b.length) return false;
	return timingSafeEqual(Buffer.from(a), Buffer.from(b));
};

/**
 * Translate the TRUST_PROXY config value into what Express's `trust proxy`
 * setting expects. Without this, running Pluton behind a reverse proxy
 * (Caddy, Nginx, Traefik, ...) makes express-rate-limit throw
 * ERR_ERL_UNEXPECTED_X_FORWARDED_FOR, because the proxy sends X-Forwarded-For
 * while Express trusts no proxy by default.
 *
 * Accepted values:
 *   - "true"/"false"           -> boolean
 *   - a number (e.g. "1")      -> trust that many hops (unsafe with mixed-length
 *                                 proxy/direct-LAN paths unless independently restricted)
 *   - IP / subnet list         -> passed through as a comma-separated string
 *
 * Prefer reviewed last-hop peer addresses/subnets protected by firewall rules.
 * Neither "true" nor a blind hop count is safe for simultaneous proxy/direct access:
 * a shorter client path can spoof forwarding metadata and defeat rate limits.
 */
export function parseTrustProxy(value: string): boolean | number | string[] {
	const trimmed = value.trim();
	if (trimmed.toLowerCase() === 'true') return true;
	if (trimmed.toLowerCase() === 'false') return false;

	const asNumber = Number(trimmed);
	if (Number.isInteger(asNumber) && asNumber >= 0) return asNumber;

	// Otherwise treat it as a comma-separated list of trusted IPs/subnets.
	return trimmed
		.split(',')
		.map(entry => entry.trim())
		.filter(Boolean);
}
