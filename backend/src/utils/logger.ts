import pino from 'pino';
import { appPaths } from '../utils/AppPaths';

// Declare the main logger and all specialized loggers, but do not initialize them.
// We use 'let' because their values will be assigned later.
let logger: pino.Logger;
let cronLogger: pino.Logger;
let notificationLogger: pino.Logger;
let serverLogger: pino.Logger;
let StorageLogger: pino.Logger;
let SystemLogger: pino.Logger;

/**
 * Creates a child logger for device-specific logging.
 * Used throughout the codebase for logging device-related events and errors.
 *
 * @param deviceId - Optional device identifier to attach to log entries
 * @returns A pino child logger scoped to the device
 *
 * @example
 * const log = DeviceLogger('dev123');
 * log.info('Device started');
 */
const DeviceLogger = (deviceId?: string) =>
	logger.child({ module: 'Device', ...(deviceId && { deviceId }) });

/**
 * Initializes the main logger and all specialized child loggers.
 * Safe to call multiple times; does nothing if already initialized.
 *
 * Used in application startup (see createApp.ts) to set up logging for all modules.
 */
export function initializeLogger(): void {
	// If already initialized, do nothing. This makes the function safe to call multiple times.
	if (logger) {
		return;
	}

	const logPath = appPaths.getLogsDir();

	// 1. Create and assign the main logger instance.
	const isProduction = process.env.NODE_ENV === 'production';

	const targets: any[] = [
		{
			target: 'pino/file',
			options: { destination: `${logPath}/app.log` },
			level: 'info',
		},
	];

	// Only use pino-pretty in development (not available in production)
	if (!isProduction) {
		targets.unshift({
			target: 'pino-pretty',
			options: {
				colorize: true,
				translateTime: 'SYS:standard',
				ignore: 'pid,hostname',
			},
			level: 'info',
		});
	}

	const mainLogger = pino({
		transport: { targets },
	});

	logger = mainLogger;

	// 2. NOW that the main logger exists, create and assign all the child loggers.
	cronLogger = logger.child({ module: 'CRON' });
	notificationLogger = logger.child({ module: 'Notification' });
	serverLogger = logger.child({ module: 'Server' });
	StorageLogger = logger.child({ module: 'Storage' });
	SystemLogger = logger.child({ module: 'System' });
}

// Cache for plan-specific loggers to avoid creating multiple instances
const planLoggers: Record<string, pino.Logger> = {};

// Specialized backup logger that writes to plan-specific log files
/**
 * Returns a logger for plan-specific or backup-specific logging.
 * If a planId is provided, logs are written to a dedicated plan log file.
 * Used in backup/restore flows and for tracking plan operations.
 *
 * @param task - The module or task name (e.g., 'backup', 'restore', 'update')
 * @param planId - Optional plan identifier for plan-specific logging
 * @param backupId - Optional backup identifier for backup-specific logging
 * @returns A pino logger instance with appropriate metadata
 *
 * @example
 * const log = planLogger('backup', 'plan123', 'backup456');
 * log.info('Backup started');
 */
export const planLogger = (task: string, planId?: string, backupId?: string) => {
	const metadata = {
		module: task,
		...(planId && { planId }),
		...(backupId && { backupId }),
	};

	if (planId) {
		if (!planLoggers[planId]) {
			planLoggers[planId] = pino({
				transport: {
					targets: [
						{
							target: 'pino/file',
							options: { destination: `${appPaths.getLogsDir()}/plan-${planId}.log` },
							level: 'info',
						},
					],
				},
			});
		}
		return planLoggers[planId].child(metadata);
	}

	return logger.child(metadata);
};

export {
	logger,
	cronLogger,
	notificationLogger,
	serverLogger,
	StorageLogger,
	SystemLogger,
	DeviceLogger,
};
