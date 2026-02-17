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

export const safeCompare = (a: string, b: string): boolean => {
	if (a.length !== b.length) return false;
	return timingSafeEqual(Buffer.from(a), Buffer.from(b));
};
