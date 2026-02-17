/**
 * Manages global rclone and restic settings stored as JSON files in data/config/.
 * These files are written when the user updates device settings and read by
 * runRcloneCommand / runResticCommand to inject the settings as CLI flags or env vars.
 *
 * This avoids setting system-level environment variables (security concern)
 * and avoids requiring database access from utility functions / managers.
 */

import fs from 'fs';
import path from 'path';
import { appPaths } from './AppPaths';
import { DeviceSettings } from '../types/devices';

// ---------- File paths ----------

const getRcloneSettingsPath = () => path.join(appPaths.getConfigDir(), 'rclone_global.json');
const getResticSettingsPath = () => path.join(appPaths.getConfigDir(), 'restic_global.json');

// ---------- In-memory caches ----------

let rcloneSettingsCache: DeviceSettings['rclone'] | null = null;
let resticSettingsCache: DeviceSettings['restic'] | null = null;

// ---------- Write helpers (called from updateSettings) ----------

/**
 * Persist rclone global settings to `data/config/rclone_global.json`.
 * Only creates the file when the user explicitly changes settings.
 */
export function saveRcloneGlobalSettings(settings: DeviceSettings['rclone']): void {
	const filePath = getRcloneSettingsPath();
	fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), { mode: 0o600 });
	// Update in-memory cache
	rcloneSettingsCache = settings ?? null;
}

/**
 * Persist restic global settings to `data/config/restic_global.json`.
 * Only creates the file when the user explicitly changes settings.
 */
export function saveResticGlobalSettings(settings: DeviceSettings['restic']): void {
	const filePath = getResticSettingsPath();
	fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), { mode: 0o600 });
	// Update in-memory cache
	resticSettingsCache = settings ?? null;
}

// ---------- Read helpers (called from runRcloneCommand / runResticCommand) ----------

/**
 * Load rclone global settings. Returns `undefined` if no settings file exists.
 * The result is cached in memory so the file is read at most once per process lifetime
 * (cache is invalidated on write via `saveRcloneGlobalSettings`).
 */
export function loadRcloneGlobalSettings(): DeviceSettings['rclone'] | undefined {
	if (rcloneSettingsCache !== null) {
		return rcloneSettingsCache;
	}

	const filePath = getRcloneSettingsPath();
	try {
		if (fs.existsSync(filePath)) {
			const raw = fs.readFileSync(filePath, 'utf-8');
			const parsed = JSON.parse(raw) as DeviceSettings['rclone'];
			rcloneSettingsCache = parsed ?? null;
			return parsed;
		}
	} catch (error) {
		console.error('[globalSettings] Failed to read rclone_global.json:', error);
	}
	return undefined;
}

/**
 * Load restic global settings. Returns `undefined` if no settings file exists.
 * The result is cached in memory so the file is read at most once per process lifetime
 * (cache is invalidated on write via `saveResticGlobalSettings`).
 */
export function loadResticGlobalSettings(): DeviceSettings['restic'] | undefined {
	if (resticSettingsCache !== null) {
		return resticSettingsCache;
	}

	const filePath = getResticSettingsPath();
	try {
		if (fs.existsSync(filePath)) {
			const raw = fs.readFileSync(filePath, 'utf-8');
			const parsed = JSON.parse(raw) as DeviceSettings['restic'];
			resticSettingsCache = parsed ?? null;
			return parsed;
		}
	} catch (error) {
		console.error('[globalSettings] Failed to read restic_global.json:', error);
	}
	return undefined;
}

// ---------- Env / args builders for command runners ----------

/**
 * Build extra environment variables for rclone based on global settings.
 * These are merged into the env passed to `spawn()`.
 */
export function buildRcloneEnvFromSettings(): Record<string, string> {
	const settings = loadRcloneGlobalSettings();
	if (!settings) return {};

	const env: Record<string, string> = {};

	if (settings.tempDir) env.RCLONE_TEMP_DIR = settings.tempDir;
	if (settings.cacheDir) env.RCLONE_CACHE_DIR = settings.cacheDir;
	if (settings.bwlimit) env.RCLONE_BWLIMIT = settings.bwlimit;
	if (settings.timeout) env.RCLONE_TIMEOUT = settings.timeout;
	if (settings.retries) env.RCLONE_RETRIES = String(settings.retries);
	if (settings.lowLevelRetries) env.RCLONE_LOW_LEVEL_RETRIES = String(settings.lowLevelRetries);
	if (settings.transfers) env.RCLONE_TRANSFERS = String(settings.transfers);
	if (settings.checkers) env.RCLONE_CHECKERS = String(settings.checkers);
	if (settings.bufferSize) env.RCLONE_BUFFER_SIZE = settings.bufferSize;
	if (settings.multiThreadStream)
		env.RCLONE_MULTI_THREAD_STREAMS = String(settings.multiThreadStream);
	if (settings.configPass) env.RCLONE_CONFIG_PASS = settings.configPass;

	return env;
}

/**
 * Build extra environment variables for restic based on global settings.
 * These are merged into the env passed to `spawn()`.
 */
export function buildResticEnvFromSettings(): Record<string, string> {
	const settings = loadResticGlobalSettings();
	if (!settings) return {};

	const env: Record<string, string> = {};

	if (settings.maxProcessor) env.GOMAXPROCS = String(settings.maxProcessor);
	if (settings.cacheDir) env.RESTIC_CACHE_DIR = settings.cacheDir;
	if (settings.readConcurrency) env.RESTIC_READ_CONCURRENCY = String(settings.readConcurrency);
	if (settings.packSize) env.RESTIC_PACK_SIZE = settings.packSize;

	return env;
}

/**
 * Build extra CLI arguments for restic based on global settings.
 * These are appended to the args array passed to `spawn()`.
 */
export function buildResticArgsFromSettings(): string[] {
	const settings = loadResticGlobalSettings();
	if (!settings) return [];

	const extraArgs: string[] = [];

	if (settings.packSize) {
		extraArgs.push('--pack-size', settings.packSize);
	}
	if (settings.readConcurrency) {
		extraArgs.push('--read-concurrency', String(settings.readConcurrency));
	}

	return extraArgs;
}
