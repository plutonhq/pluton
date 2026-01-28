import { Task } from './AbstractTask';
import { cronLogger } from '../../utils/logger';
import path from 'path';
import { readdir, stat, rm } from 'fs/promises';
import { appPaths } from '../../utils/AppPaths';
import { Job } from '../JobQueue';

export class CleanDownloadsTask extends Task {
	name = 'CleanDownloads';

	async run(job: Job): Promise<void> {
		const ninetySixHours = 96 * 60 * 60 * 1000;
		const now = Date.now();

		const dirsToClean = [
			appPaths.getDownloadsDir(),
			appPaths.getRestoresDir(),
			appPaths.getProgressDir(),
			appPaths.getCacheDir(),
		];

		for (const dir of dirsToClean) {
			try {
				const files = await readdir(dir);
				for (const file of files) {
					const filePath = path.join(dir, file);
					const fileStat = await stat(filePath);

					if (now - fileStat.mtime.getTime() > ninetySixHours) {
						await rm(filePath, { recursive: true, force: true });
					}
				}
			} catch (error: any) {
				if (error.code !== 'ENOENT') {
					cronLogger.error(`Error cleaning directory: ${dir}`);
				}
			}
		}
	}
}
