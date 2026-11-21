import { Job } from '../JobQueue';

export abstract class Task {
	abstract name: string;
	isBackup?: boolean; // Counts toward MAX_CONCURRENT_BACKUPS. 
	abstract run(job?: Job): Promise<void>;
}
