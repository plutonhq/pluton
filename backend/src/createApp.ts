import path from 'path';
import { fileURLToPath } from 'url';
import express, { type Express } from 'express';
import { IncomingMessage, ServerResponse } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { db } from './db';
import { createPlanRouter } from './routes/plans';
import { createDeviceRouter } from './routes/devices';
import { createStorageRouter } from './routes/storages';
import { createRestoreRouter } from './routes/restores';
import { createUserRouter } from './routes/users';
import { createSettingsRouter } from './routes/settings';
import { createHealthRouter } from './routes/health';
import { createSetupRouter } from './routes/setup';
import { PlanController } from './controllers/PlanController';
import { DeviceController } from './controllers/DeviceController';
import { StorageController } from './controllers/StorageController';
import { RestoreController } from './controllers/RestoreController';
import { UserController } from './controllers/UserController';
import { SettingsController } from './controllers/SettingsController';
import { SetupController } from './controllers/SetupController';
import { createBackupRouter } from './routes/backups';
import { BackupController } from './controllers/BackupController';

import versionMiddleware from './middlewares/versionMiddleware';
import { PlanStore } from './stores/PlanStore';
import { BackupStore } from './stores/BackupStore';
import { PlanService } from './services/PlanService';
import { RestoreStore } from './stores/RestoreStore';
import { SettingsStore } from './stores/SettingsStore';
import { StorageStore } from './stores/StorageStore';
import { DeviceStore } from './stores/DeviceStore';
import { BaseBackupManager } from './managers';
import { BackupEventListener } from './services/listeners/BackupEventListener';
import { BackupService } from './services/BackupServices';
import { BaseSnapshotManager } from './managers/BaseSnapshotManager';
import { RestoreService } from './services/RestoreService';
import { RestoreEventListener } from './services/listeners/RestoreEventListener';
import { DownloadEventListener } from './services/listeners/DownloadEventListener';
import { DeviceService } from './services/DeviceService';
import { BaseSystemManager } from './managers/BaseSystemManager';
import { BaseStorageManager } from './managers/BaseStorageManager';
import { StorageService } from './services/StorageService';
import { SettingsService } from './services/SettingsService';
import { systemTaskManager } from './jobs/SystemTaskManager';
import { jobProcessor } from './jobs/JobProcessor';
import { initializeLogger } from './utils/logger';
import { configService } from './services/ConfigService';
import { BaseRestoreManager } from './managers/BaseRestoreManager';

export async function createApp(): Promise<{ app: Express }> {
	// Initialize Logger
	initializeLogger();

	// Stores
	const planStore = new PlanStore(db);
	const backupStore = new BackupStore(db);
	const storageStore = new StorageStore(db);
	const deviceStore = new DeviceStore(db);
	const restoreStore = new RestoreStore(db);
	const settingsStore = new SettingsStore(db);

	// Local Agents
	const localPlanAgent = new BaseBackupManager();
	const localBackupAgent = new BaseSnapshotManager();
	const localRestoreAgent = new BaseRestoreManager();
	const localSystemAgent = new BaseSystemManager();
	const localStorageAgent = new BaseStorageManager();

	// Event Listeners
	new BackupEventListener(localPlanAgent, planStore, backupStore);
	new RestoreEventListener(localRestoreAgent, planStore, backupStore, restoreStore);
	new DownloadEventListener(localBackupAgent, backupStore);

	// Main Application Services
	const planService = new PlanService(
		localPlanAgent,
		planStore,
		backupStore,
		storageStore,
		deviceStore,
		restoreStore
	);
	const backupService = new BackupService(
		localBackupAgent,
		localPlanAgent,
		planStore,
		backupStore,
		restoreStore,
		storageStore
	);
	const restoreService = new RestoreService(
		localRestoreAgent,
		planStore,
		backupStore,
		restoreStore,
		storageStore
	);
	const deviceService = new DeviceService(localSystemAgent, deviceStore, planStore, storageStore);
	const storageService = new StorageService(
		localStorageAgent,
		localSystemAgent,
		storageStore,
		planStore
	);
	const settingsService = new SettingsService(settingsStore);

	// API Route Controllers
	const planController = new PlanController(planService);
	const backupController = new BackupController(backupService);
	const restoreController = new RestoreController(restoreService);
	const deviceController = new DeviceController(deviceService);
	const storageController = new StorageController(storageService);
	const settingsController = new SettingsController(settingsService);
	const userController = new UserController();
	const setupController = new SetupController();

	console.log('process.env.APP_URL :', process.env.APP_URL);
	console.log(' configService.config.APP_URL:', configService.config.APP_URL);
	// Express App
	const app = express();
	app.use(
		cors({
			origin: [
				process.env.APP_URL as string, // Vite core frontend dev server
				configService.config.APP_URL || 'http://mypluton.com', // Production domain
			],
			credentials: true,
			methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
			exposedHeaders: ['X-App-Version', 'X-Server-OS'],
		})
	);
	app.use(versionMiddleware);
	app.use(express.json());

	// helmet security middleware
	const appUrl = configService.config.APP_URL || 'http://localhost';
	const serverPort = configService.config.SERVER_PORT;
	const isDev = configService.isDevelopment();

	// Dynamically derive the request origin from the Host header.
	// This handles all access methods: localhost, LAN IPs, custom domains,
	// and reverse proxies (Nginx, Traefik, etc.) that set x-forwarded-proto.
	const dynamicOrigin = (req: IncomingMessage, _res: ServerResponse) => {
		const host = req.headers.host;
		if (host) {
			const proto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
			return `${proto}://${host}`;
		}
		return `http://localhost:${serverPort}`;
	};

	// In dev, also allow explicit localhost/127.0.0.1 with the backend port
	// so the Vite dev server (different origin) can reach the API.
	const connectSrc: (string | typeof dynamicOrigin)[] = ["'self'", appUrl, dynamicOrigin];
	if (isDev) {
		connectSrc.push(`http://localhost:${serverPort}`, `http://127.0.0.1:${serverPort}`);
	}

	app.use(
		helmet({
			contentSecurityPolicy: {
				directives: {
					defaultSrc: ["'self'"],
					scriptSrc: ["'self'", "'unsafe-inline'"],
					styleSrc: ["'self'", "'unsafe-inline'"],
					imgSrc: ["'self'", 'data:', 'blob:'],
					fontSrc: ["'self'", 'data:'],
					connectSrc,
					frameAncestors: ["'none'"],
					baseUri: ["'self'"],
					formAction: ["'self'"],
					upgradeInsecureRequests: isDev ? null : [],
				},
			},
			hsts: false, // Don't force HTTPS — users may run over HTTP on LAN
		})
	);

	//  Serve static files from the 'public' directory
	// The frontend build files will be placed here
	const __filename = fileURLToPath(import.meta.url);
	const __dirname = path.dirname(__filename);
	const publicPath = path.join(__dirname, '..', 'public');
	app.use(express.static(publicPath));

	// Rate Limiter
	const apiLimiter = rateLimit({
		windowMs: 15 * 60 * 1000, // 15 minutes
		max: 1000, // Limit each IP to 1000 requests per window
		standardHeaders: true,
		legacyHeaders: false,
	});

	app.use('/api/', apiLimiter);

	// Strict rate limiter for setup routes (unauthenticated)
	const setupLimiter = rateLimit({
		windowMs: 15 * 60 * 1000, // 15 minutes
		max: 10, // Only 10 attempts per window
		standardHeaders: true,
		legacyHeaders: false,
	});
	// Strict authentication rate limiter to prevent brute-force attacks
	const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

	app.use('/api/setup', setupLimiter, createSetupRouter(setupController)); // Setup route (no auth required)
	app.use('/api/user', createUserRouter(userController, authLimiter));
	app.use('/api/plans', createPlanRouter(planController));
	app.use('/api/backups', createBackupRouter(backupController));
	app.use('/api/devices', createDeviceRouter(deviceController));
	app.use('/api/storages', createStorageRouter(storageController));
	app.use('/api/restores', createRestoreRouter(restoreController));
	app.use('/api/settings', createSettingsRouter(settingsController));
	app.use('/api/health', createHealthRouter());

	// For any other request that doesn't match an API route or a static file,
	// serve the index.html file. This is the key for Single Page Applications.
	app.get('{*path}', (req, res) => {
		res.sendFile(path.join(publicPath, 'index.html'));
	});

	// Start System task schedules
	systemTaskManager.initialize();

	// Start Backup Job Schedules
	jobProcessor.registerTasks({
		backupManager: localPlanAgent,
		restoreManager: localRestoreAgent,
	});

	jobProcessor.start();

	return { app };
}
