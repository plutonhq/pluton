import path from 'path';
import { fileURLToPath } from 'url';
import express, { type Express } from 'express';
import { registerSpaFallback } from './utils/spaFallback';
import session from 'express-session';
import createMemoryStore from 'memorystore';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { db, sqlite } from './db';
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
import { createLegacyRepositoryRouter } from './routes/legacyRepositories';
import { LegacyRepositoryController } from './controllers/LegacyRepositoryController';

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
import { ReplicationEventListener } from './services/listeners/ReplicationEventListener';
import { BackupService } from './services/BackupServices';
import { BaseSnapshotManager } from './managers/BaseSnapshotManager';
import { RestoreService } from './services/RestoreService';
import { RemoteRepositoryRecoveryService } from './services/RemoteRepositoryRecoveryService';
import { RestoreEventListener } from './services/listeners/RestoreEventListener';
import { DownloadEventListener } from './services/listeners/DownloadEventListener';
import { DeviceService } from './services/DeviceService';
import { BaseSystemManager } from './managers/BaseSystemManager';
import { BaseStorageManager } from './managers/BaseStorageManager';
import { StorageService } from './services/StorageService';
import { SettingsService } from './services/SettingsService';
import { SelfBackupService } from './services/SelfBackupService';
import { StartupRecovery } from './services/StartupRecovery';
import { SystemTaskManager } from './jobs/SystemTaskManager';
import { SYSTEM_JOBS } from './jobs/systemJobs';
import { jobProcessor } from './jobs/JobProcessor';
import { SelfBackupTask } from './jobs/tasks/SelfBackupTask';
import { initializeLogger } from './utils/logger';
import { configService } from './services/ConfigService';
import { BaseRestoreManager } from './managers/BaseRestoreManager';
import { parseTrustProxy } from './utils/helpers';
import { LegacyRepositoryStore } from './stores/LegacyRepositoryStore';
import { LegacyRestoreJobStore } from './stores/LegacyRestoreJobStore';
import { LegacyRepositoryService } from './services/LegacyRepositoryService';
import { AgentStore } from './stores/AgentStore';
import { RemoteManagedRepositoryStore } from './stores/RemoteManagedRepositoryStore';
import { AgentService } from './services/AgentService';
import { RemoteBackupService } from './services/RemoteBackupService';
import { AgentController } from './controllers/AgentController';
import { AgentAdminController } from './controllers/AgentAdminController';
import { createAgentRouter } from './routes/agents';
import { createAgentAdminRouter } from './routes/agentAdmin';
import type { AgentRequest } from './types/agents';
import { RecoveryTestStore } from './stores/RecoveryTestStore';
import { RecoveryTestService } from './services/RecoveryTestService';
import { RecoveryTestController } from './controllers/RecoveryTestController';
import { createRecoveryTestRouter } from './routes/recoveryTests';
import { RecoveryTestTask } from './jobs/tasks/RecoveryTestTask';
import { jobQueue } from './jobs/JobQueue';
import { NotificationDeliveryStore } from './stores/NotificationDeliveryStore';
import { NotificationDeliveryManager } from './notifications/NotificationDeliveryManager';
import { createNotificationRouter, notificationInputError } from './routes/notifications';
import { DatabaseRestoreStore } from './stores/DatabaseRestoreStore';
import { DatabaseRestoreService } from './services/DatabaseRestoreService';
import { AutomaticRecoveryLifecycle } from './utils/automaticRecoveryLifecycle';
import { PersistentRestoreTargets } from './utils/persistentRestoreTargets';
import { InternalRecoveryTargets } from './utils/internalRecoveryTargets';
import { createDatabaseRestoreRouter, databaseRestoreInputError } from './routes/databaseRestores';
import { parseWebOrigins } from './utils/webOrigins';
import { webAccess, originAwareSession, sameOriginCors } from './middlewares/webAccess';
import { ManagedReplicationStore } from './stores/ManagedReplicationStore';
import { ManagedReplicationService } from './services/ManagedReplicationService';
import { configureProtectedStorageDatabase, s3RepositoryScope } from './utils/storageSecurity';
import { configureReplicaScopeResolver } from './utils/managedReplicationPolicy';

const MemoryStore = createMemoryStore(session);

export async function createApp(): Promise<{ app: Express; shutdown: () => Promise<void> }> {
	// Initialize Logger
	initializeLogger();
	// Explicit startup ownership, including compiled ESM: no lazy CommonJS DB loading.
	configureProtectedStorageDatabase(sqlite);
	configureReplicaScopeResolver(s3RepositoryScope);

	// Stores
	const planStore = new PlanStore(db);
	const backupStore = new BackupStore(db);
	const storageStore = new StorageStore(db);
	const deviceStore = new DeviceStore(db);
	const restoreStore = new RestoreStore(db);
	const settingsStore = new SettingsStore(db);
	const notificationStore = new NotificationDeliveryStore(sqlite, configService.config.SECRET);
	const notificationManager = new NotificationDeliveryManager(notificationStore);
	const legacyRepositoryStore = new LegacyRepositoryStore(db);
	const legacyRestoreJobStore = new LegacyRestoreJobStore(db);
	const agentStore = new AgentStore(db);
	const remoteManagedRepositoryStore = new RemoteManagedRepositoryStore(db);

	// Local Agents
	const localPlanAgent = new BaseBackupManager();
	const localBackupAgent = new BaseSnapshotManager();
	const localRestoreAgent = new BaseRestoreManager();
	const localSystemAgent = new BaseSystemManager();
	const localStorageAgent = new BaseStorageManager();
	const remoteBackupService = new RemoteBackupService(
		remoteManagedRepositoryStore,
		agentStore,
		planStore,
		backupStore,
		storageStore
	);
	const managedReplicationStore = new ManagedReplicationStore(sqlite);
	const managedReplicationService = new ManagedReplicationService(
		managedReplicationStore,
		backupStore,
		planStore,
		remoteManagedRepositoryStore,
		agentStore,
		storageStore,
		remoteBackupService
	);
	remoteBackupService.setReplicationService(managedReplicationService);
	const remoteRecoveryService = new RemoteRepositoryRecoveryService(
		remoteManagedRepositoryStore,
		backupStore,
		planStore,
		restoreStore,
		remoteBackupService,
		agentStore
	);
	const recoveryTestStore = new RecoveryTestStore(db, configService.config.SECRET);
	const automaticLifecycle =
		process.env.PLUTON_AUTOMATIC_RECOVERY === 'enabled'
			? new AutomaticRecoveryLifecycle(sqlite)
			: undefined;
	const internalTargets = new InternalRecoveryTargets(undefined, undefined, automaticLifecycle);
	const recoveryTestService = new RecoveryTestService(
		recoveryTestStore,
		planStore,
		backupStore,
		remoteRecoveryService,
		undefined,
		undefined,
		internalTargets
	);
	const databaseRestoreService = new DatabaseRestoreService(
		new DatabaseRestoreStore(sqlite, configService.config.SECRET),
		planStore,
		remoteRecoveryService,
		new PersistentRestoreTargets(undefined, undefined, undefined, undefined, automaticLifecycle)
	);

	// Event Listeners
	new BackupEventListener(localPlanAgent, planStore, backupStore);
	new ReplicationEventListener(localPlanAgent, planStore, backupStore, storageStore);
	new RestoreEventListener(localRestoreAgent, planStore, backupStore, restoreStore);
	new DownloadEventListener(localBackupAgent, backupStore);

	// Main Application Services
	const planService = new PlanService(
		localPlanAgent,
		planStore,
		backupStore,
		storageStore,
		deviceStore,
		restoreStore,
		remoteBackupService,
		recoveryTestStore,
		managedReplicationStore
	);
	const backupService = new BackupService(
		localBackupAgent,
		localPlanAgent,
		planStore,
		backupStore,
		restoreStore,
		storageStore,
		remoteBackupService,
		remoteRecoveryService,
		managedReplicationService
	);
	const restoreService = new RestoreService(
		localRestoreAgent,
		planStore,
		backupStore,
		restoreStore,
		storageStore,
		remoteRecoveryService
	);
	const agentService = new AgentService(
		agentStore,
		configService.config.SECRET,
		undefined,
		remoteBackupService
	);
	const deviceService = new DeviceService(
		localSystemAgent,
		deviceStore,
		planStore,
		storageStore,
		agentService
	);
	const storageService = new StorageService(
		localStorageAgent,
		localSystemAgent,
		storageStore,
		planStore,
		settingsStore
	);
	const selfBackupService = new SelfBackupService(settingsStore, storageStore, sqlite, 'core');
	const settingsService = new SettingsService(settingsStore, selfBackupService);
	const legacyRepositoryService = new LegacyRepositoryService(
		legacyRepositoryStore,
		undefined,
		legacyRestoreJobStore
	);

	// API Route Controllers
	const planController = new PlanController(planService);
	const backupController = new BackupController(backupService);
	const restoreController = new RestoreController(restoreService);
	const deviceController = new DeviceController(deviceService);
	const storageController = new StorageController(storageService);
	const settingsController = new SettingsController(settingsService);
	const userController = new UserController(settingsService);
	const setupController = new SetupController();
	const legacyRepositoryController = new LegacyRepositoryController(legacyRepositoryService);
	const agentController = new AgentController(agentService);
	const agentAdminController = new AgentAdminController(agentService);

	// Express App
	const app = express();

	// Reverse proxy support
	const trustProxy = configService.config.TRUST_PROXY;
	if (trustProxy !== undefined && trustProxy !== '') {
		app.set('trust proxy', parseTrustProxy(trustProxy));
	}

	const webPolicy = parseWebOrigins(configService.config);
	app.use(webAccess(webPolicy));
	app.use(sameOriginCors(webPolicy));

	// Session Middleware for 2FA Setup Process
	app.use(
		'/api',
		originAwareSession(webPolicy, {
			store: new MemoryStore({
				checkPeriod: 86400000,
			}),
			secret: configService.config.SECRET,
			resave: false,
			saveUninitialized: false,
			cookie: {
				httpOnly: true,
				sameSite: 'lax',
				maxAge: 1000 * 60 * 15,
			},
		})
	);
	app.use(versionMiddleware);
	app.use('/api/database-restores', express.json({ limit: '8kb' }));
	app.use(databaseRestoreInputError);
	app.use(
		express.json({
			verify: (req, _res, buffer) => {
				(req as AgentRequest).rawBody = buffer.toString('utf8');
			},
		})
	);

	app.use(notificationInputError);

	// helmet security middleware
	const serverPort = configService.config.SERVER_PORT;
	const isDev = configService.isDevelopment();

	// In dev, also allow explicit localhost/127.0.0.1 with the backend port
	// so the Vite dev server (different origin) can reach the API.
	const connectSrc: string[] = ["'self'"];
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
					upgradeInsecureRequests: null,
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
	app.use('/api/notifications', createNotificationRouter(notificationStore));
	app.use('/api/legacy-repositories', createLegacyRepositoryRouter(legacyRepositoryController));
	app.use('/api/agent', createAgentRouter(agentController, agentService));
	app.use('/api/agent-admin', createAgentAdminRouter(agentAdminController));
	app.use(
		'/api/recovery-testing',
		createRecoveryTestRouter(new RecoveryTestController(recoveryTestService))
	);
	app.use('/api/health', createHealthRouter());
	app.use('/api/database-restores', createDatabaseRestoreRouter(databaseRestoreService));
	app.use(databaseRestoreInputError);

	// For any other request that doesn't match an API route or a static file,
	// serve the index.html file. This is the key for Single Page Applications.
	registerSpaFallback(app, publicPath);

	// Clean up backups/restores left "in progress" by a previous shutdown, before any schedule job starts.
	await new StartupRecovery(planService).run();
	await legacyRepositoryService.recoverInterruptedRestores();
	await recoveryTestService.recoverInterrupted();
	await databaseRestoreService.recoverInterrupted();
	await managedReplicationService.recoverInterrupted();

	// Reconcile CronManager schedules with the database (fixes drift on restart)
	try {
		await planService.reconcileSchedules();
	} catch (error: any) {
		console.error('[Startup] Schedule reconciliation failed:', error?.message);
	}

	// Start System task schedules
	const systemTaskManager = SystemTaskManager.getInstance(SYSTEM_JOBS);
	systemTaskManager.initialize();

	// Start Backup Job Schedules
	jobProcessor.registerTasks({
		backupManager: localPlanAgent,
		restoreManager: localRestoreAgent,
	});

	// Self Backup Task
	jobProcessor.addTask(new SelfBackupTask(selfBackupService));
	jobProcessor.addTask(new RecoveryTestTask(recoveryTestService));
	// The durable recovery queue is reconciled independently of backup completion
	// callbacks, including a crash between completion persistence and dispatch.
	const recoveryTick = setInterval(() => {
		jobQueue.add('RecoveryTest', undefined, 1);
		void databaseRestoreService.tick().catch(() => {
			// Durable executor/cleanup intent remains in SQLite. No raw provider error logging.
		});
		void managedReplicationService.tick().catch(() => {});
	}, 5000);
	recoveryTick.unref();
	// Reconcile missed dispatch from durable primary completion in bounded batches.
	let replicationReconcileRunning = false;
	const replicationReconcile = setInterval(() => {
		if (replicationReconcileRunning) return;
		replicationReconcileRunning = true;
		void managedReplicationService
			.rescanCompleted()
			.catch(() => {})
			.finally(() => {
				replicationReconcileRunning = false;
			});
	}, 30000);
	replicationReconcile.unref();
	jobQueue.add('RecoveryTest', undefined, 1);

	jobProcessor.start();
	notificationManager.start();

	return {
		app,
		shutdown: async () => {
			await notificationManager.shutdown();
			clearInterval(recoveryTick);
			clearInterval(replicationReconcile);
			await managedReplicationService.shutdown();
			await recoveryTestService.shutdown();
			await databaseRestoreService.shutdown();
		},
	};
}
