// src/utils/AppPaths.ts

import path from 'path';
import os from 'os';
import fs from 'fs'; // Use the synchronous fs module

/**
 * Defines the structure for all application paths.
 */
interface IAppPaths {
	base: string;
	data: string;
	db: string;
	schedules: string;
	logs: string;
	progress: string;
	stats: string;
	temp: string;
	downloads: string;
	restores: string;
	sync: string;
	config: string;
	rescue: string;
}

/**
 * Singleton class for managing application paths.
 */
class AppPaths {
	private static instance: AppPaths;
	private paths!: IAppPaths;
	private isInitialized = false;

	// The constructor is now responsible for immediate, synchronous initialization.
	private constructor() {
		this.initializeSync();
	}

	public static getInstance(): AppPaths {
		if (!AppPaths.instance) {
			AppPaths.instance = new AppPaths();
		}
		return AppPaths.instance;
	}

	/**
	 * Determines the base directory for all Pluton data based on the environment.
	 */
	private getTheBaseDir(): string {
		// if dev use /data
		if (process.env.NODE_ENV !== 'production') {
			return path.join(process.cwd(), 'data');
		}

		// 1. Highest Priority: Check for the Docker environment variable.
		if (process.env.IS_DOCKER === 'true') {
			return '/data';
		}

		// 2. Second Priority: Allow an explicit override via environment variable.
		if (process.env.PLUTON_DATA_DIR) {
			return process.env.PLUTON_DATA_DIR;
		}

		// 3. Default to standard system-level service directories.
		const appName = 'Pluton';
		switch (os.platform()) {
			case 'win32':
				return path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', appName);
			case 'darwin':
			case 'linux':
			default:
				return path.join('/var/lib', appName.toLowerCase());
		}
	}

	/**
	 * Synchronously initializes all application paths and creates the directories.
	 * This runs automatically the first time AppPaths.getInstance() is called.
	 */
	private initializeSync(): void {
		if (this.isInitialized) {
			return;
		}

		const baseDir = this.getTheBaseDir();
		const tempBase = os.tmpdir();

		this.paths = {
			base: baseDir,
			data: baseDir,
			db: path.join(baseDir, 'db'),
			schedules: path.join(baseDir, 'schedules.json'),
			logs: path.join(baseDir, 'logs'),
			progress: path.join(baseDir, 'progress'),
			stats: path.join(baseDir, 'stats'),
			temp: path.join(tempBase, 'pluton'),
			downloads: path.join(tempBase, 'pluton', 'downloads'),
			restores: path.join(tempBase, 'pluton', 'restores'),
			sync: path.join(baseDir, 'sync'),
			config: path.join(baseDir, 'config'),
			rescue: path.join(baseDir, 'rescue'),
		};

		const directoriesToCreate = [
			this.paths.base,
			this.paths.db,
			this.paths.logs,
			this.paths.progress,
			this.paths.stats,
			this.paths.temp,
			this.paths.downloads,
			this.paths.restores,
			this.paths.sync,
			this.paths.config,
			this.paths.rescue,
		];

		for (const dir of directoriesToCreate) {
			try {
				// Use synchronous mkdir
				fs.mkdirSync(dir, { recursive: true });
			} catch (error: any) {
				if (error.code !== 'EEXIST') {
					console.error(
						`FATAL: Could not create directory ${dir}. Please ensure you have the correct permissions (run with sudo/administrator).`
					);
					throw error; // Halt execution
				}
			}
		}

		const rcloneConfPath = path.join(this.paths.config, 'rclone.conf');
		if (!fs.existsSync(rcloneConfPath)) {
			try {
				fs.writeFileSync(rcloneConfPath, '', { mode: 0o600 });
			} catch (error: any) {
				console.error(`FATAL: Could not create rclone.conf at ${rcloneConfPath}.`);
				throw error;
			}
		}

		this.isInitialized = true;
	}

	private checkInitialized(): void {
		// This check is now mostly redundant but good for safety.
		if (!this.isInitialized) {
			throw new Error('AppPaths failed to initialize.');
		}
	}

	// --- GETTER METHODS ---
	public getBaseDir(): string {
		this.checkInitialized();
		return this.paths.base;
	}
	public getDataDir(): string {
		this.checkInitialized();
		return this.paths.data;
	}
	public getDbDir(): string {
		this.checkInitialized();
		return this.paths.db;
	}
	public getSchedulesPath(): string {
		this.checkInitialized();
		return this.paths.schedules;
	}
	public getLogsDir(): string {
		this.checkInitialized();
		return this.paths.logs;
	}
	public getProgressDir(): string {
		this.checkInitialized();
		return this.paths.progress;
	}
	public getStatsDir(): string {
		this.checkInitialized();
		return this.paths.stats;
	}
	public getTempDir(): string {
		this.checkInitialized();
		return this.paths.temp;
	}
	public getDownloadsDir(): string {
		this.checkInitialized();
		return this.paths.downloads;
	}
	public getRestoresDir(): string {
		this.checkInitialized();
		return this.paths.restores;
	}
	public getSyncDir(): string {
		this.checkInitialized();
		return this.paths.sync;
	}
	public getConfigDir(): string {
		this.checkInitialized();
		return this.paths.config;
	}

	public getRescueDir(): string {
		this.checkInitialized();
		return this.paths.rescue;
	}
}

// Export the singleton instance. The first time this is imported and used,
// the constructor will run and initialize everything.
export const appPaths = AppPaths.getInstance();
