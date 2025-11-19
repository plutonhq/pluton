import { Cron } from 'croner';
import path from 'path';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { appPaths } from '../utils/AppPaths';

interface ScheduleOptions {
	isActive: boolean;
	taskCallback: (id: string, opts: Record<string, any>) => void;
	[key: string]: any;
}

interface StoredSchedule<T> {
	id: string;
	scheduleType: string;
	cronExpression: string;
	options: T;
}

interface ScheduleEntry<T> {
	type: string;
	cron: Cron;
	options: T;
}

interface TaskCallbacks {
	[key: string]: (id: string, opts: Record<string, any>) => Promise<any>;
}

export class CronManager<T extends ScheduleOptions> {
	// Make this property static and private
	private static instance: CronManager<any>;
	private schedules: Map<string, ScheduleEntry<T>[]> = new Map();
	private initialized: Promise<void>;
	private taskCallbacks: TaskCallbacks;
	private readonly SCHEDULE_FILE: string;

	// Make the constructor private
	private constructor(taskCallbacks: TaskCallbacks, scheduleFilePath?: string) {
		const dataDir = appPaths.getDataDir();
		this.SCHEDULE_FILE = scheduleFilePath || path.join(dataDir, 'schedules.json');
		console.log('[CronManager] Using schedule file at:', this.SCHEDULE_FILE);
		this.taskCallbacks = taskCallbacks;
		this.initialized = this.loadSchedules();
	}

	// Add the public static getInstance method
	public static getInstance<T extends ScheduleOptions>(
		taskCallbacks: TaskCallbacks,
		scheduleFilePath?: string
	): CronManager<T> {
		if (!CronManager.instance) {
			CronManager.instance = new CronManager<T>(taskCallbacks, scheduleFilePath);
		}
		return CronManager.instance;
	}

	private async saveSchedules(): Promise<void> {
		const scheduleData: StoredSchedule<T>[] = [];

		this.schedules.forEach((entries, id) => {
			entries.forEach(entry => {
				scheduleData.push({
					id,
					cronExpression: (entry.options as any).cronExpression,
					scheduleType: entry.type,
					options: entry.options,
				});
			});
		});

		await mkdir(path.dirname(this.SCHEDULE_FILE), { recursive: true });
		await writeFile(this.SCHEDULE_FILE, JSON.stringify(scheduleData, null, 2));
	}

	async loadSchedules(): Promise<void> {
		try {
			const data = await readFile(this.SCHEDULE_FILE, 'utf8');
			const scheduleData: StoredSchedule<T>[] = JSON.parse(data);

			for (const { id, cronExpression, options, scheduleType } of scheduleData) {
				const taskOptions = {
					...options,
					taskCallback: this.taskCallbacks[scheduleType],
				};

				await this.scheduleTask(id, cronExpression, taskOptions, scheduleType);
			}
		} catch (error: any) {
			if (error.code !== 'ENOENT') {
				console.error('Error loading schedules:', error);
			}
		}
	}

	async scheduleTask(
		id: string,
		cronExpression: string,
		options: T,
		scheduleType: string
	): Promise<void> {
		console.log('[scheduleTask] :', id, scheduleType, cronExpression);

		const existingSchedules = this.schedules.get(id) || [];

		// Check if a schedule with the same type already exists
		const existingSchedule = existingSchedules.find(s => s.type === scheduleType);
		if (existingSchedule) {
			console.warn(
				`⚠️Schedule with id '${id}' and type '${scheduleType}' already exists. Skipping.`
			);
			return;
		}

		try {
			// === DEBUG LOGGING START ===
			const cronInstanceId = `cron_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
			console.log(
				`[DEBUG_CRON] ATTEMPTING TO CREATE new Cron instance ${cronInstanceId} for plan ${id}.`
			);
			// === DEBUG LOGGING END ===

			const cron = new Cron(cronExpression, () => {
				// === DEBUG LOGGING START ===
				console.log(`[DEBUG_CRON] FIRING Cron instance ${cronInstanceId} for plan ${id}.`);
				// === DEBUG LOGGING END ===
				console.log('[scheduleTask] :', `Executing cron task for ${id}`, typeof options);
				if (
					options &&
					typeof options === 'object' &&
					'taskCallback' in options &&
					(options as any).taskCallback
				) {
					(options as any).taskCallback(id, options);
				}
			});

			if (options && typeof options === 'object' && 'isActive' in options && !options.isActive) {
				cron.pause();
			}

			existingSchedules.push({ type: scheduleType, cron, options });
			this.schedules.set(id, existingSchedules);
			await this.saveSchedules();
		} catch (error: any) {
			throw new Error(`Could Not Schedule Cron. ${error.message}`);
		}
	}

	async updateSchedule(
		id: string,
		cronExpression: string,
		options: T,
		scheduleType: string
	): Promise<void> {
		await this.initialized;
		const existingSchedules = this.schedules.get(id);
		if (existingSchedules) {
			const scheduleToUpdate = existingSchedules.find(s => s.type === scheduleType);
			if (scheduleToUpdate) {
				try {
					scheduleToUpdate.cron.stop();
					const newCron = new Cron(cronExpression, () => {
						if (options && typeof options === 'object' && 'taskCallback' in options) {
							(options as any).taskCallback(id, options);
						}
					});

					if (
						options &&
						typeof options === 'object' &&
						'isActive' in options &&
						!options.isActive
					) {
						newCron.pause();
					}

					const updatedSchedules = existingSchedules.map(s =>
						s.type === scheduleType ? { type: scheduleType, cron: newCron, options } : s
					);

					this.schedules.set(id, updatedSchedules);
					await this.saveSchedules();
				} catch (error: any) {
					throw new Error(`Could Not Schedule Cron with Updated Settings. ${error.message}`);
				}
			}
		}
	}

	async removeSchedule(id: string): Promise<void> {
		await this.initialized;
		const schedules = this.schedules.get(id);
		if (schedules) {
			schedules.forEach(schedule => schedule.cron.stop());
			this.schedules.delete(id);
			await this.saveSchedules();
		}
	}

	async getSchedule(id: string): Promise<ScheduleEntry<T>[] | undefined> {
		await this.initialized;
		return this.schedules.get(id);
	}

	getScheduleSync(id: string): ScheduleEntry<T>[] | undefined {
		// This assumes `initialized` promise has already resolved during startup.
		return this.schedules.get(id);
	}

	async getSchedules(): Promise<Map<string, ScheduleEntry<T>[]>> {
		await this.initialized;
		return this.schedules;
	}

	async pauseSchedule(id: string): Promise<boolean> {
		await this.initialized;
		const schedules = this.schedules.get(id);
		if (schedules) {
			const success = schedules.every(schedule => {
				schedule.options.isActive = false;
				return schedule.cron.pause();
			});

			if (success) {
				await this.saveSchedules();
			}

			return success;
		}
		return false;
	}

	async resumeSchedule(id: string): Promise<boolean> {
		await this.initialized;
		const schedules = this.schedules.get(id);
		if (schedules) {
			const success = schedules.every(schedule => {
				schedule.options.isActive = true;
				return schedule.cron.resume();
			});

			if (success) {
				await this.saveSchedules();
			}

			return success;
		}
		return false;
	}
}
