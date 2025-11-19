import { CronManager } from '../../src/managers/CronManager';
import { Cron } from 'croner';
import * as fs from 'fs/promises';
import path from 'path';

// Mock dependencies
jest.mock('croner');
jest.mock('fs/promises');
jest.mock('../../src/utils/AppPaths', () => ({
	appPaths: {
		getDataDir: jest.fn(() => path.join('/tmp', 'pluton-test')),
	},
}));

// Define a type for the mock task options for clarity
interface MockScheduleOptions {
	isActive: boolean;
	taskCallback: (id: string, opts: Record<string, any>) => void;
	someData: string;
	cronExpression: string;
}

describe('CronManager', () => {
	let cronManager: CronManager<MockScheduleOptions>;
	let mockTaskCallbacks: { [key: string]: jest.Mock };
	const mockScheduleFile = path.join('/tmp', 'pluton-test', 'schedules.json');

	// This will hold the mock instances of Cron created in each test
	const mockCronInstances: jest.Mocked<Cron>[] = [];

	beforeEach(() => {
		// Reset all mocks and clear the instance array before each test
		jest.clearAllMocks();
		mockCronInstances.length = 0;

		// Reset the singleton instance before each test
		(CronManager as any).instance = undefined;

		// Mock the Cron constructor to intercept its creation
		(Cron as jest.Mock).mockImplementation((expression, callback) => {
			const mockCron: jest.Mocked<Cron> = {
				stop: jest.fn(),
				pause: jest.fn().mockReturnValue(true),
				resume: jest.fn().mockReturnValue(true),
			} as any;

			// Add a 'fire' method to our mock instance to simulate a cron trigger
			(mockCron as any).fire = () => callback();

			mockCronInstances.push(mockCron);
			return mockCron;
		});

		// Mock the file system module
		(fs.mkdir as jest.Mock).mockResolvedValue(undefined);
		(fs.writeFile as jest.Mock).mockResolvedValue(undefined);
		// Default to simulating that the schedules.json file does not exist
		(fs.readFile as jest.Mock).mockRejectedValue({ code: 'ENOENT' });

		// Mock the callback functions that tasks would execute
		mockTaskCallbacks = {
			backup: jest.fn(),
			prune: jest.fn(),
		};

		// Initialize a fresh CronManager instance for each test using getInstance
		cronManager = CronManager.getInstance(mockTaskCallbacks);
	});

	describe('Initialization and Loading', () => {
		it('should initialize without errors when no schedule file exists', async () => {
			// The beforeEach hook already sets up the "file not found" scenario.
			// We wait for the initialization promise to resolve.
			await (cronManager as any).initialized;

			expect(fs.readFile).toHaveBeenCalledWith(mockScheduleFile, 'utf8');
			expect(Cron).not.toHaveBeenCalled(); // No schedules to create
		});

		it('should load and recreate schedules from an existing file', async () => {
			// Arrange: Mock readFile to return a predefined set of schedules
			const storedSchedules = [
				{
					id: 'plan-1',
					scheduleType: 'backup',
					cronExpression: '* * * * *',
					options: { someData: 'backup data', cronExpression: '* * * * *' },
				},
				{
					id: 'plan-2',
					scheduleType: 'prune',
					cronExpression: '0 0 * * *',
					options: { someData: 'prune data', cronExpression: '0 0 * * *' },
				},
			];
			(fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(storedSchedules));

			// Reset the singleton instance to force a new instance creation
			(CronManager as any).instance = undefined;

			// Act: Get a new instance to trigger the constructor's loading logic
			const newCronManager = CronManager.getInstance(mockTaskCallbacks);
			await (newCronManager as any).initialized; // Wait for initialization

			// Assert: Verify that Cron was called for each loaded schedule
			expect(Cron).toHaveBeenCalledTimes(2);
			expect(Cron).toHaveBeenCalledWith('* * * * *', expect.any(Function));
			expect(Cron).toHaveBeenCalledWith('0 0 * * *', expect.any(Function));

			const schedules = await newCronManager.getSchedules();
			expect(schedules.has('plan-1')).toBe(true);
			expect(schedules.get('plan-1')?.[0].type).toBe('backup');
		});

		it('should handle paused schedules correctly when loading from file', async () => {
			// Arrange: Mock a schedule that is marked as inactive
			const storedSchedules = [
				{
					id: 'plan-paused',
					scheduleType: 'backup',
					cronExpression: '* * * * *',
					options: { isActive: false, someData: 'paused data', cronExpression: '* * * * *' },
				},
			];
			(fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(storedSchedules));

			// Reset the singleton instance to force a new instance creation
			(CronManager as any).instance = undefined;

			// Act
			const newCronManager = CronManager.getInstance(mockTaskCallbacks);
			await (newCronManager as any).initialized;

			// Assert: The created Cron instance should have its pause() method called
			expect(Cron).toHaveBeenCalledTimes(1);
			expect(mockCronInstances[0].pause).toHaveBeenCalledTimes(1);
		});
	});

	describe('scheduleTask', () => {
		it('should schedule a new task, save it, and ensure its callback works', async () => {
			// Arrange
			const planId = 'plan-new';
			const cronExpression = '*/5 * * * *';
			const options: MockScheduleOptions = {
				someData: 'new task data',
				isActive: true,
				taskCallback: mockTaskCallbacks.backup,
				cronExpression,
			};

			// Act
			await cronManager.scheduleTask(planId, cronExpression, options, 'backup');

			// Assert: A new Cron job was created
			expect(Cron).toHaveBeenCalledWith(cronExpression, expect.any(Function));

			// Assert: The new schedule was saved to the file
			expect(fs.writeFile).toHaveBeenCalledTimes(1);
			const savedData = JSON.parse((fs.writeFile as jest.Mock).mock.calls[0][1]);
			expect(savedData[0].id).toBe(planId);
			expect(savedData[0].options.someData).toBe('new task data');

			// Assert: Manually firing the mock cron triggers the correct callback
			(mockCronInstances[0] as any).fire();
			expect(mockTaskCallbacks.backup).toHaveBeenCalledWith(planId, options);
		});

		it('should create a paused schedule if isActive is false', async () => {
			// Arrange
			const options: MockScheduleOptions = {
				someData: 'paused task',
				isActive: false, // Key property for this test
				taskCallback: mockTaskCallbacks.backup,
				cronExpression: '* * * * *',
			};

			// Act
			await cronManager.scheduleTask('plan-paused', '* * * * *', options, 'backup');

			// Assert: The created Cron instance should be paused immediately
			expect(mockCronInstances[0].pause).toHaveBeenCalledTimes(1);
		});

		it('should not schedule a duplicate task for the same ID and type', async () => {
			// Arrange
			const options: MockScheduleOptions = {
				someData: 'first task',
				isActive: true,
				taskCallback: mockTaskCallbacks.backup,
				cronExpression: '* * * * *',
			};
			await cronManager.scheduleTask('plan-1', '* * * * *', options, 'backup');

			// Act: Attempt to schedule the exact same task again
			await cronManager.scheduleTask('plan-1', '* * * * *', options, 'backup');

			// Assert: The Cron constructor and writeFile should only have been called once
			expect(Cron).toHaveBeenCalledTimes(1);
			expect(fs.writeFile).toHaveBeenCalledTimes(1);
		});
	});

	describe('updateSchedule', () => {
		it('should stop the old job and start a new one with updated options', async () => {
			// Arrange: Create an initial schedule
			const planId = 'plan-to-update';
			await cronManager.scheduleTask(planId, '* * * * *', { someData: 'initial' } as any, 'backup');
			const oldCronInstance = mockCronInstances[0];

			// Act: Update the schedule with a new expression and options
			const newExpression = '0 0 * * *';
			const newOptions: MockScheduleOptions = {
				someData: 'updated',
				isActive: true,
				taskCallback: mockTaskCallbacks.backup,
				cronExpression: newExpression,
			};
			await cronManager.updateSchedule(planId, newExpression, newOptions, 'backup');

			// Assert
			expect(oldCronInstance.stop).toHaveBeenCalledTimes(1); // Old job was stopped
			expect(Cron).toHaveBeenCalledTimes(2); // Called for create and update
			expect(Cron).toHaveBeenLastCalledWith(newExpression, expect.any(Function));

			// Assert the file was updated correctly
			const savedData = JSON.parse((fs.writeFile as jest.Mock).mock.calls[1][1]);
			expect(savedData[0].options.someData).toBe('updated');
		});
	});

	describe('removeSchedule', () => {
		it('should remove a schedule, stop its cron job, and update the file', async () => {
			// Arrange
			const planId = 'plan-to-remove';
			await cronManager.scheduleTask(
				planId,
				'* * * * *',
				{ someData: 'to remove' } as any,
				'backup'
			);
			const createdCronInstance = mockCronInstances[0];

			// Act
			await cronManager.removeSchedule(planId);

			// Assert
			expect(createdCronInstance.stop).toHaveBeenCalledTimes(1); // Job was stopped

			// Assert file was saved with an empty array
			const savedData = JSON.parse((fs.writeFile as jest.Mock).mock.calls[1][1]);
			expect(savedData).toEqual([]);

			const schedules = await cronManager.getSchedules();
			expect(schedules.has(planId)).toBe(false); // Removed from internal map
		});
	});

	describe('pauseSchedule and resumeSchedule', () => {
		it('should pause a running schedule and save its state', async () => {
			// Arrange
			const planId = 'plan-to-pause';
			await cronManager.scheduleTask(planId, '* * * * *', { isActive: true } as any, 'backup');
			const cronInstance = mockCronInstances[0];

			// Act
			const result = await cronManager.pauseSchedule(planId);

			// Assert
			expect(result).toBe(true);
			expect(cronInstance.pause).toHaveBeenCalledTimes(1);

			// Check that the saved state reflects the change
			const savedData = JSON.parse((fs.writeFile as jest.Mock).mock.calls[1][1]);
			expect(savedData[0].options.isActive).toBe(false);
		});

		it('should resume a paused schedule and save its state', async () => {
			// Arrange: Create a schedule that is initially paused
			await cronManager.scheduleTask(
				'plan-to-resume',
				'* * * * *',
				{ isActive: false } as any,
				'backup'
			);
			const cronInstance = mockCronInstances[0];
			expect(cronInstance.pause).toHaveBeenCalledTimes(1); // Paused on creation

			// Act
			const result = await cronManager.resumeSchedule('plan-to-resume');

			// Assert
			expect(result).toBe(true);
			expect(cronInstance.resume).toHaveBeenCalledTimes(1);

			// Check that the saved state reflects the change
			const savedData = JSON.parse((fs.writeFile as jest.Mock).mock.calls[1][1]);
			expect(savedData[0].options.isActive).toBe(true);
		});
	});

	describe('Error Handling', () => {
		it('should log an error if loading schedules fails for reasons other than ENOENT', async () => {
			// Arrange
			const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
			const error = new Error('Permission denied');
			(error as any).code = 'EACCES';
			(fs.readFile as jest.Mock).mockRejectedValue(error);

			// Reset the singleton instance to force a new instance creation
			(CronManager as any).instance = undefined;

			// Act
			const newCronManager = CronManager.getInstance(mockTaskCallbacks);
			await (newCronManager as any).initialized;

			// Assert
			expect(consoleErrorSpy).toHaveBeenCalledWith('Error loading schedules:', error);

			consoleErrorSpy.mockRestore();
		});

		it('should throw an error if cron expression is invalid', async () => {
			// Arrange: Mock Cron to throw an error on invalid expression
			(Cron as jest.Mock).mockImplementation(() => {
				throw new Error('Invalid cron expression');
			});

			// Act & Assert: Expect scheduleTask to reject with a specific message
			await expect(
				cronManager.scheduleTask('plan-invalid', 'invalid-expression', {} as any, 'backup')
			).rejects.toThrow('Could Not Schedule Cron. Invalid cron expression');
		});
	});
});
