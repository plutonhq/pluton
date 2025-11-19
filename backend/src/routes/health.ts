import { Router, Request, Response } from 'express';
import { existsSync } from 'fs';
import { db } from '../db';
import { getBinaryPath } from '../utils/binaryPathResolver';

export function createHealthRouter(router: Router = Router()): Router {
	router.get('/', async (req: Request, res: Response) => {
		try {
			const health = {
				status: 'healthy',
				timestamp: new Date().toISOString(),
				uptime: process.uptime(),
				version: process.env.APP_VERSION || 'unknown',
				checks: {
					database: false,
					mqtt: false,
					restic: false,
					rclone: false,
					rear: false,
					dataDir: false,
				},
			};

			// Check database connectivity
			try {
				db.run('SELECT 1');
				health.checks.database = true;
			} catch (error) {
				health.status = 'unhealthy';
				health.checks.database = false;
			}

			// Check restic binary
			try {
				const resticPath = getBinaryPath('restic');
				health.checks.restic = existsSync(resticPath);
			} catch {
				health.checks.restic = false;
			}

			// Check rclone binary
			try {
				const rclonePath = getBinaryPath('rclone');
				health.checks.rclone = existsSync(rclonePath);
			} catch {
				health.checks.rclone = false;
			}

			// Check data directory write access
			try {
				const { appPaths } = await import('../utils/AppPaths');
				const testFile = `${appPaths.getDataDir()}/.health-check`;
				const { writeFileSync, unlinkSync } = await import('fs');
				writeFileSync(testFile, 'test');
				unlinkSync(testFile);
				health.checks.dataDir = true;
			} catch {
				health.checks.dataDir = false;
			}

			// Set overall status
			const allHealthy = Object.values(health.checks).every(check => check === true);
			if (!allHealthy) {
				health.status = 'degraded';
			}

			const statusCode = health.status === 'healthy' ? 200 : 503;
			res.status(statusCode).json(health);
		} catch (error) {
			res.status(503).json({
				status: 'unhealthy',
				timestamp: new Date().toISOString(),
				error: error instanceof Error ? error.message : 'Unknown error',
			});
		}
	});

	return router;
}
