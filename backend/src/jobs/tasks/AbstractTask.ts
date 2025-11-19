import { Job } from '../JobQueue';

export abstract class Task {
	abstract name: string;
	abstract run(job?: Job): Promise<void>;
}
