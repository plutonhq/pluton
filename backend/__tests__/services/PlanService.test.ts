import fs from 'fs';
import * as fsPromises from 'fs/promises';
import { Readable } from 'stream';
import { PlanService } from '../../src/services/PlanService';
import { PlanStore } from '../../src/stores/PlanStore';
import { StorageStore } from '../../src/stores/StorageStore';
import { DeviceStore } from '../../src/stores/DeviceStore';
import { RestoreStore } from '../../src/stores/RestoreStore';
import { BaseBackupManager } from '../../src/managers/BaseBackupManager';
import { NewPlanReq, PlanBackupSettings } from '../../src/types/plans';
import { NotFoundError } from '../../src/utils/AppError';
import { initializeLogger } from '../../src/utils/logger';

// Mock the dependencies using Jest's mocking factory
jest.mock('../../src/stores/PlanStore');
jest.mock('../../src/stores/StorageStore');
jest.mock('../../src/stores/DeviceStore');
jest.mock('../../src/managers/BaseBackupManager');
jest.mock('../../src/stores/RestoreStore');

// We also need to mock the strategy that gets instantiated inside the service
jest.mock('../../src/strategies/backup/LocalStrategy');
import { LocalStrategy } from '../../src/strategies/backup/LocalStrategy';
import { BackupStore } from '../../src/stores/BackupStore';

describe('PlanService', () => {
	let planService: PlanService;
	let mockPlanStore: jest.Mocked<PlanStore>;
	let mockBackupStore: jest.Mocked<BackupStore>;
	let mockStorageStore: jest.Mocked<StorageStore>;
	let mockDeviceStore: jest.Mocked<DeviceStore>;
	let mockRestoreStore: jest.Mocked<RestoreStore>;
	let mockLocalAgent: jest.Mocked<BaseBackupManager>;
	let mockStrategy: jest.Mocked<LocalStrategy>;

	let performBackupSpy: jest.SpyInstance;

	beforeAll(() => {
		// This now guarantees the logger is initialized for this test file.
		initializeLogger();
	});

	// Before each test, create new instances of the service and mocks
	beforeEach(() => {
		// Reset mocks to clear any previous calls
		jest.clearAllMocks();

		mockPlanStore = new PlanStore(null as any) as jest.Mocked<PlanStore>;
		mockStorageStore = new StorageStore(null as any) as jest.Mocked<StorageStore>;
		mockBackupStore = new BackupStore(null as any) as jest.Mocked<BackupStore>;
		mockDeviceStore = new DeviceStore(null as any) as jest.Mocked<DeviceStore>;
		mockRestoreStore = new RestoreStore(null as any) as jest.Mocked<RestoreStore>;
		mockLocalAgent = new BaseBackupManager() as jest.Mocked<BaseBackupManager>;

		mockBackupStore.deleteByPlanId = jest.fn();
		mockRestoreStore.deleteByPlanId = jest.fn();

		// The service instantiates the strategy, so we need to mock its constructor and methods
		mockStrategy = new LocalStrategy(mockLocalAgent) as jest.Mocked<LocalStrategy>;
		(LocalStrategy as jest.Mock).mockReturnValue(mockStrategy);

		planService = new PlanService(
			mockLocalAgent,
			mockPlanStore,
			mockBackupStore,
			mockStorageStore,
			mockDeviceStore,
			mockRestoreStore
		);
	});

	// ------------------------

	describe('createPlan', () => {
		// --- THIS SETUP ONLY APPLIES TO 'createPlan' TESTS ---
		beforeEach(() => {
			// Spy on the 'performBackup' method ONLY for this suite of tests.
			// This prevents the background task from running and crashing other tests.
			performBackupSpy = jest
				.spyOn(planService, 'performBackup')
				.mockImplementation(() => Promise.resolve());
		});

		afterEach(() => {
			// Clean up the spy after each 'createPlan' test.
			performBackupSpy.mockRestore();
		});

		const planData: NewPlanReq = {
			title: 'Test Plan',
			storage: { id: 'storage-123', name: 'Test Storage' },
			storagePath: '/backups/test',
			sourceId: 'main', // Testing with the local device
			sourceType: 'device',
			sourceConfig: { includes: ['/data/important'], excludes: [] },
			method: 'backup',
			tags: [],
			settings: {
				interval: { type: 'daily', time: '10:00AM' },
				// ... other settings
			} as PlanBackupSettings, // Using 'as any' for brevity in example
		};

		it('should throw a Zod validation error if required fields are missing', async () => {
			// Arrange: Create plan data that is intentionally invalid
			const invalidPlanData = {
				// title is missing
				storage: { id: 'storage-123', name: 'Test Storage' },
				storagePath: '/backups/test',
				sourceId: 'main',
				sourceType: 'device',
				sourceConfig: { includes: ['/data/important'], excludes: [] },
				method: 'backup',
				settings: {
					interval: { type: 'daily', time: '10:00AM' },
				},
			} as any; // Use 'as any' to bypass TypeScript's static checking for the test

			// Act & Assert
			// We expect the promise to reject. Zod throws its own error type.
			await expect(planService.createPlan(invalidPlanData)).rejects.toThrow();
		});

		it('should successfully create a plan and its schedule', async () => {
			// Arrange: Set up the return values for our mocked dependencies
			const mockStorage = { id: 'storage-123', name: 'Test Storage', type: 'local' };
			const mockDevice = { id: 'main', name: 'Main Server' };
			const createdPlan = { id: 'plan-xyz', ...planData };

			mockStorageStore.getById.mockResolvedValue(mockStorage as any);
			mockDeviceStore.getById.mockResolvedValue(mockDevice as any);
			mockStrategy.createBackup.mockResolvedValue({ success: true, result: 'OK' });
			mockPlanStore.create.mockResolvedValue(createdPlan as any);

			// Act: Call the method we are testing
			const result = await planService.createPlan(planData);

			// Assert: Verify that the correct methods were called with the correct arguments
			expect(mockStorageStore.getById).toHaveBeenCalledWith('storage-123');
			expect(mockDeviceStore.getById).toHaveBeenCalledWith('main');
			expect(mockStrategy.createBackup).toHaveBeenCalled();
			expect(mockPlanStore.create).toHaveBeenCalled();
			expect(result.id).toBe('plan-xyz');
		});

		it('should throw a NotFoundError if the storage does not exist', async () => {
			// Arrange: Mock the storage store to return null
			mockStorageStore.getById.mockResolvedValue(null);

			// Act & Assert: Expect a rejection and then inspect the error object
			await expect(planService.createPlan(planData)).rejects.toThrow('Storage not found');

			// Add a more specific check for the status code
			await expect(planService.createPlan(planData)).rejects.toHaveProperty('statusCode', 404);
		});

		it('should throw a NotFoundError if the device does not exist', async () => {
			// Arrange: Mock storage to resolve but device to fail
			mockStorageStore.getById.mockResolvedValue({
				id: 'storage-123',
				name: 'Test Storage',
				type: 'local',
			} as any);
			mockDeviceStore.getById.mockResolvedValue(null);

			// Act & Assert
			await expect(planService.createPlan(planData)).rejects.toThrow('Source device not found');

			// Add a more specific check for the status code
			await expect(planService.createPlan(planData)).rejects.toHaveProperty('statusCode', 404);
		});

		it('should throw an AppError if the backup strategy fails to create a schedule', async () => {
			// Arrange
			mockStorageStore.getById.mockResolvedValue({
				id: 'storage-123',
				name: 'Test Storage',
				type: 'local',
			} as any);
			mockDeviceStore.getById.mockResolvedValue({ id: 'main', name: 'Main Server' } as any);
			mockStrategy.createBackup.mockResolvedValue({ success: false, result: 'Cron job failed' });

			// Act & Assert
			await expect(planService.createPlan(planData)).rejects.toThrow('Cron job failed');
		});

		it('should sanitize the storagePath before creating the schedule and saving', async () => {
			// Arrange
			const dirtyPlanData = {
				...planData,
				storagePath: ' /backups/with spaces/ ', // <-- Dirty path with leading/trailing spaces and slashes
			};
			const sanitizedPath = 'backups/with spaces'; // This is what we expect

			// Mock dependencies to succeed
			mockStorageStore.getById.mockResolvedValue({
				id: 'storage-123',
				name: 'Test Storage',
				type: 'b2',
			} as any);
			mockDeviceStore.getById.mockResolvedValue({ id: 'main', name: 'Main Server' } as any);
			mockStrategy.createBackup.mockResolvedValue({ success: true, result: 'OK' });
			mockPlanStore.create.mockResolvedValue({ id: 'plan-xyz', ...dirtyPlanData } as any);

			// Act
			await planService.createPlan(dirtyPlanData);

			// Assert
			// Check that the strategy was called with the SANITIZED path
			expect(mockStrategy.createBackup).toHaveBeenCalledWith(
				expect.any(String), // The planId
				expect.objectContaining({
					storagePath: sanitizedPath, // Check the specific property
				})
			);

			// Check that the store was called with the SANITIZED path
			expect(mockPlanStore.create).toHaveBeenCalledWith(
				expect.objectContaining({
					storagePath: sanitizedPath,
				})
			);
		});

		it('should throw an AppError if saving the plan to the database fails', async () => {
			// Arrange: Mock everything to succeed EXCEPT the final database write
			mockStorageStore.getById.mockResolvedValue({
				id: 'storage-123',
				name: 'Test Storage',
				type: 'local',
			} as any);
			mockDeviceStore.getById.mockResolvedValue({ id: 'main', name: 'Main Server' } as any);
			mockStrategy.createBackup.mockResolvedValue({ success: true, result: 'OK' });
			mockPlanStore.create.mockResolvedValue(null); // <-- Simulate a DB write failure

			// Act & Assert
			await expect(planService.createPlan(planData)).rejects.toThrow(
				'Failed to save the new plan to the database.'
			);
			await expect(planService.createPlan(planData)).rejects.toHaveProperty('statusCode', 500);
		});
	});

	// -------------------------
	// Tests for updating a plan
	// -------------------------
	describe('updatePlan', () => {
		const planId = 'plan-to-update';
		const currentPlan = {
			id: planId,
			title: 'Original Title',
			sourceId: 'main',
			storageId: 'storage-123',
			settings: {
				interval: { type: 'daily', time: '10:00AM' },
			},
			// ... other plan properties
		} as any;

		const updateData = {
			title: 'Updated Title',
			settings: {
				...currentPlan.settings,
				interval: { type: 'weekly', days: 'sun', time: '02:00PM' },
			},
		};

		it('should successfully update a plan and its schedule', async () => {
			// Arrange
			const updatedPlan = { ...currentPlan, ...updateData };
			mockPlanStore.getById.mockResolvedValue(currentPlan);
			mockPlanStore.update.mockResolvedValue(updatedPlan);
			mockStorageStore.getById.mockResolvedValue({
				id: 'storage-123',
				name: 'Test Storage',
				type: 'local',
			} as any);
			mockStrategy.updateBackup.mockResolvedValue({ success: true, result: 'OK' });

			// Act
			const result = await planService.updatePlan(planId, updateData);

			// Assert
			expect(mockPlanStore.getById).toHaveBeenCalledWith(planId);
			expect(mockPlanStore.update).toHaveBeenCalledWith(planId, updateData);
			expect(mockStrategy.updateBackup).toHaveBeenCalledWith(
				planId,
				expect.objectContaining({
					cronExpression: '00 14 * * 0', // 2:00 PM on Sunday
				})
			);
			expect(result).toEqual(updatedPlan);
		});

		it('should throw a NotFoundError if the plan does not exist', async () => {
			// Arrange
			mockPlanStore.getById.mockResolvedValue(null);

			// Act & Assert
			// Keep the message check as it's good practice
			await expect(planService.updatePlan(planId, updateData)).rejects.toThrow('Plan not found.');
			// --- ADD THIS SPECIFIC CHECK ---
			await expect(planService.updatePlan(planId, updateData)).rejects.toHaveProperty(
				'statusCode',
				404
			);
			// -------------------------------
		});

		it('should throw an AppError if the strategy fails to update the schedule', async () => {
			// Arrange
			mockPlanStore.getById.mockResolvedValue(currentPlan);
			mockPlanStore.update.mockResolvedValue({ ...currentPlan, ...updateData });
			mockStorageStore.getById.mockResolvedValue({
				id: 'storage-123',
				name: 'Test Storage',
				type: 'local',
			} as any);
			mockStrategy.updateBackup.mockResolvedValue({ success: false, result: 'Strategy failed' });

			// Act & Assert
			await expect(planService.updatePlan(planId, updateData)).rejects.toThrow('Strategy failed');
		});

		it('should throw a validation error for invalid update data', async () => {
			// Arrange
			const invalidUpdateData = { settings: { interval: 'not-an-object' } };
			mockPlanStore.getById.mockResolvedValue(currentPlan);

			// Act & Assert
			await expect(planService.updatePlan(planId, invalidUpdateData as any)).rejects.toThrow(); // Zod will throw its own specific error
		});
	});

	// -------------------------
	// Tests for deleting a plan
	// -------------------------

	describe('deletePlan', () => {
		const planId = 'plan-to-delete';
		const mockPlan = {
			id: planId,
			title: 'Plan to Delete',
			sourceId: 'main',
			storageId: 'storage-123',
			storagePath: '/backups/delete',
			storage: { name: 'Test Storage' }, // This comes from the joined query in the store
			settings: { encryption: true },
		} as any;

		it('should successfully delete a plan, its schedule, and its data', async () => {
			// Arrange
			mockPlanStore.getById.mockResolvedValue(mockPlan);
			mockStrategy.removeBackup.mockResolvedValue({ success: true, result: 'OK' });
			mockBackupStore.deleteByPlanId.mockResolvedValue(true);
			mockPlanStore.delete.mockResolvedValue(true);

			// Act
			const result = await planService.deletePlan(planId, true);

			// Assert
			expect(mockPlanStore.getById).toHaveBeenCalledWith(planId);
			expect(mockStrategy.removeBackup).toHaveBeenCalledWith(planId, {
				storageName: 'Test Storage',
				storagePath: '/backups/delete',
				encryption: true,
				removeRemoteData: true, // We passed true to the service method
			});
			expect(mockBackupStore.deleteByPlanId).toHaveBeenCalledWith(planId);
			expect(mockPlanStore.delete).toHaveBeenCalledWith(planId);
			expect(result).toBe(true);
		});

		it('should throw a NotFoundError if the plan does not exist', async () => {
			// Arrange
			mockPlanStore.getById.mockResolvedValue(null);

			// Act & Assert
			await expect(planService.deletePlan(planId, true)).rejects.toHaveProperty('statusCode', 404);
		});

		it('should throw an AppError if the strategy fails to remove the backup', async () => {
			// Arrange
			mockPlanStore.getById.mockResolvedValue(mockPlan);
			mockStrategy.removeBackup.mockResolvedValue({
				success: false,
				result: 'Strategy deletion failed',
			});

			// Act & Assert
			await expect(planService.deletePlan(planId, true)).rejects.toThrow(
				'Strategy deletion failed'
			);

			// Verify that the database deletion was NOT attempted
			expect(mockPlanStore.delete).not.toHaveBeenCalled();
			expect(mockBackupStore.deleteByPlanId).not.toHaveBeenCalled();
		});

		it('should throw an AppError if the database deletion fails', async () => {
			// Arrange
			mockPlanStore.getById.mockResolvedValue(mockPlan);
			mockStrategy.removeBackup.mockResolvedValue({ success: true, result: 'OK' });
			mockBackupStore.deleteByPlanId.mockResolvedValue(true);
			mockPlanStore.delete.mockResolvedValue(false); // Simulate DB delete failure

			// Act & Assert
			await expect(planService.deletePlan(planId, true)).rejects.toThrow(
				'Failed to delete plan from the database.'
			);
		});
	});

	// -------------------------------
	// Tests for getting a single plan
	// -------------------------------
	describe('getPlan', () => {
		const planId = 'plan-123';
		const mockPlan = {
			id: planId,
			title: 'My Test Plan',
			sourceId: 'main',
			// ... other properties
		} as any;

		it('should return a single plan when a valid ID is provided', async () => {
			// Arrange
			mockPlanStore.getById.mockResolvedValue(mockPlan);

			// Act
			const result = await planService.getPlan(planId);

			// Assert
			expect(mockPlanStore.getById).toHaveBeenCalledWith(planId, true); // Verifies history is true by default
			expect(result).toEqual(mockPlan);
		});

		it('should request history based on the history parameter', async () => {
			// Arrange
			mockPlanStore.getById.mockResolvedValue(mockPlan);

			// Act
			await planService.getPlan(planId, false); // Explicitly request no history

			// Assert
			expect(mockPlanStore.getById).toHaveBeenCalledWith(planId, false);
		});

		it('should throw a NotFoundError if the plan does not exist', async () => {
			// Arrange
			mockPlanStore.getById.mockResolvedValue(null);

			// Act & Assert
			await expect(planService.getPlan(planId)).rejects.toThrow('Plan not found');
			await expect(planService.getPlan(planId)).rejects.toHaveProperty('statusCode', 404);
		});
	});

	// -------------------------------
	// Tests for getting all plans
	// -------------------------------
	describe('getAllPlans', () => {
		const mockPlans = [
			{ id: 'plan-1', title: 'Plan One' },
			{ id: 'plan-2', title: 'Plan Two' },
		] as any[];

		it('should return an array of all plans', async () => {
			// Arrange
			mockPlanStore.getAll.mockResolvedValue(mockPlans);

			// Act
			const result = await planService.getAllPlans();

			// Assert
			expect(mockPlanStore.getAll).toHaveBeenCalledWith(true); // Verifies history is true by default
			expect(result).toEqual(mockPlans);
			expect(result).toHaveLength(2);
		});

		it('should return null if the store returns null', async () => {
			// Arrange
			mockPlanStore.getAll.mockResolvedValue(null);

			// Act
			const result = await planService.getAllPlans();

			// Assert
			expect(mockPlanStore.getAll).toHaveBeenCalledWith(true);
			expect(result).toBeNull();
		});

		it('should return an empty array if no plans exist', async () => {
			// Arrange
			mockPlanStore.getAll.mockResolvedValue([]);

			// Act
			const result = await planService.getAllPlans();

			// Assert
			expect(result).toEqual([]);
			expect(result).toHaveLength(0);
		});
	});

	// -------------------------------
	// Tests for checking active backups
	// -------------------------------
	describe('checkActiveBackupsOrRestore', () => {
		const planId = 'plan-456';

		it('should return true if the store reports active backups', async () => {
			// Arrange
			mockPlanStore.hasActiveBackups.mockResolvedValue(true);

			// Act
			const result = await planService.checkActiveBackupsOrRestore(planId, 'backup');

			// Assert
			expect(mockPlanStore.hasActiveBackups).toHaveBeenCalledWith(planId);
			expect(result).toBe(true);
		});

		it('should return false if the store reports no active backups', async () => {
			// Arrange
			mockPlanStore.hasActiveBackups.mockResolvedValue(false);

			// Act
			const result = await planService.checkActiveBackupsOrRestore(planId, 'backup');

			// Assert
			expect(mockPlanStore.hasActiveBackups).toHaveBeenCalledWith(planId);
			expect(result).toBe(false);
		});
	});

	// -------------------------------
	// Tests for performing a backup
	// -------------------------------

	describe('performBackup', () => {
		const planId = 'plan-to-backup';
		const mockPlan = { id: planId, sourceId: 'main' } as any;

		it('should successfully trigger a backup via the correct strategy', async () => {
			// Arrange
			mockPlanStore.getById.mockResolvedValue(mockPlan);
			mockPlanStore.hasActiveBackups.mockResolvedValue(false);
			mockStrategy.performBackup.mockResolvedValue({ success: true, result: 'Backup initiated' });

			// Act
			await planService.performBackup(planId);

			// Assert
			expect(mockPlanStore.getById).toHaveBeenCalledWith(planId);
			expect(mockPlanStore.hasActiveBackups).toHaveBeenCalledWith(planId);
			expect(mockStrategy.performBackup).toHaveBeenCalledWith(planId);
		});

		it('should throw a NotFoundError if the plan does not exist', async () => {
			// Arrange
			mockPlanStore.getById.mockResolvedValue(null);

			// Act & Assert
			await expect(planService.performBackup(planId)).rejects.toThrow(
				`Plan with ID ${planId} not found.`
			);
			await expect(planService.performBackup(planId)).rejects.toHaveProperty('statusCode', 404);
		});

		it('should throw an AppError if a backup is already in progress', async () => {
			// Arrange
			mockPlanStore.getById.mockResolvedValue(mockPlan);
			mockPlanStore.hasActiveBackups.mockResolvedValue(true); // Simulate an active backup

			// Act & Assert
			await expect(planService.performBackup(planId)).rejects.toThrow(
				'A backup is already in progress for this plan.'
			);
			await expect(planService.performBackup(planId)).rejects.toHaveProperty('statusCode', 500); // Or 409 for Conflict
		});

		it('should throw an AppError if the strategy fails to start the backup', async () => {
			// Arrange
			mockPlanStore.getById.mockResolvedValue(mockPlan);
			mockPlanStore.hasActiveBackups.mockResolvedValue(false);
			mockStrategy.performBackup.mockResolvedValue({
				success: false,
				result: 'Strategy failed to start',
			});

			// Act & Assert
			await expect(planService.performBackup(planId)).rejects.toThrow('Strategy failed to start');
		});
	});

	// -------------------------------
	// Tests for pruning backups
	// -------------------------------
	describe('pruneBackups', () => {
		const planId = 'plan-to-prune';
		const mockPlan = { id: planId, sourceId: 'main' } as any;

		it('should successfully trigger a prune operation', async () => {
			// Arrange
			mockPlanStore.getById.mockResolvedValue(mockPlan);
			mockStrategy.pruneBackups.mockResolvedValue({ success: true, result: 'Prune successful' });

			// Act
			const result = await planService.pruneBackups(planId);

			// Assert
			expect(mockPlanStore.getById).toHaveBeenCalledWith(planId);
			expect(mockStrategy.pruneBackups).toHaveBeenCalledWith(planId);
			expect(result).toBe('Prune successful');
		});

		it('should throw a NotFoundError if the plan does not exist', async () => {
			// Arrange
			mockPlanStore.getById.mockResolvedValue(null);

			// Act & Assert
			await expect(planService.pruneBackups(planId)).rejects.toThrow(
				`Plan with ID ${planId} not found.`
			);
			await expect(planService.pruneBackups(planId)).rejects.toHaveProperty('statusCode', 404);
		});

		it('should throw an AppError if the strategy fails to prune', async () => {
			// Arrange
			mockPlanStore.getById.mockResolvedValue(mockPlan);
			mockStrategy.pruneBackups.mockResolvedValue({
				success: false,
				result: 'Prune failed at strategy level',
			});

			// Act & Assert
			await expect(planService.pruneBackups(planId)).rejects.toThrow(
				'Prune failed at strategy level'
			);
		});
	});

	// -------------------------------
	// Tests for pausing backups
	// -------------------------------

	describe('pauseBackup', () => {
		const planId = 'plan-to-pause';
		const mockPlan = { id: planId, sourceId: 'main' } as any;

		it('should successfully pause the plan via the strategy and update the store', async () => {
			// Arrange
			mockPlanStore.getById.mockResolvedValue(mockPlan);
			mockStrategy.pauseBackup.mockResolvedValue({ success: true, result: 'Paused' });

			// Act
			await planService.pauseBackup(planId);

			// Assert
			expect(mockStrategy.pauseBackup).toHaveBeenCalledWith(planId);
			expect(mockPlanStore.setActive).toHaveBeenCalledWith(planId, false);
		});

		it('should throw a NotFoundError if the plan does not exist', async () => {
			// Arrange
			mockPlanStore.getById.mockResolvedValue(null);

			// Act & Assert
			await expect(planService.pauseBackup(planId)).rejects.toThrow(
				`Plan with ID ${planId} not found.`
			);
			await expect(planService.pauseBackup(planId)).rejects.toHaveProperty('statusCode', 404);
		});

		it('should throw an AppError if the strategy fails and not update the store', async () => {
			// Arrange
			mockPlanStore.getById.mockResolvedValue(mockPlan);
			mockStrategy.pauseBackup.mockResolvedValue({ success: false, result: 'Failed to pause' });

			// Act & Assert
			await expect(planService.pauseBackup(planId)).rejects.toThrow('Failed to pause');

			// Verify that the store's state was NOT changed
			expect(mockPlanStore.setActive).not.toHaveBeenCalled();
		});
	});

	// -------------------------------
	// Tests for resuming backups
	// -------------------------------

	describe('resumeBackup', () => {
		const planId = 'plan-to-resume';
		const mockPlan = { id: planId, sourceId: 'main' } as any;

		it('should successfully resume the plan via the strategy and update the store', async () => {
			// Arrange
			mockPlanStore.getById.mockResolvedValue(mockPlan);
			mockStrategy.resumeBackup.mockResolvedValue({ success: true, result: 'Resumed' });

			// Act
			await planService.resumeBackup(planId);

			// Assert
			expect(mockStrategy.resumeBackup).toHaveBeenCalledWith(planId);
			expect(mockPlanStore.setActive).toHaveBeenCalledWith(planId, true);
		});

		it('should throw a NotFoundError if the plan does not exist', async () => {
			// Arrange
			mockPlanStore.getById.mockResolvedValue(null);

			// Act & Assert
			await expect(planService.resumeBackup(planId)).rejects.toThrow(
				`Plan with ID ${planId} not found.`
			);
			await expect(planService.resumeBackup(planId)).rejects.toHaveProperty('statusCode', 404);
		});

		it('should throw an AppError if the strategy fails and not update the store', async () => {
			// Arrange
			mockPlanStore.getById.mockResolvedValue(mockPlan);
			mockStrategy.resumeBackup.mockResolvedValue({ success: false, result: 'Failed to resume' });

			// Act & Assert
			await expect(planService.resumeBackup(planId)).rejects.toThrow('Failed to resume');

			// Verify that the store's state was NOT changed
			expect(mockPlanStore.setActive).not.toHaveBeenCalled();
		});
	});

	// --------------------------------
	// Tests for unlocking a repository
	// --------------------------------

	describe('unlockRepo', () => {
		const planId = 'plan-to-unlock';
		const mockPlan = { id: planId, sourceId: 'main' } as any;

		it('should successfully call the unlockRepo method on the strategy', async () => {
			// Arrange
			mockPlanStore.getById.mockResolvedValue(mockPlan);
			// Ensure the strategy's unlockRepo method is a mock for this test
			mockStrategy.unlockRepo = jest
				.fn()
				.mockResolvedValue({ success: true, result: 'Unlocked successfully' });

			// Act
			const result = await planService.unlockRepo(planId);

			// Assert
			expect(mockPlanStore.getById).toHaveBeenCalledWith(planId);
			expect(mockStrategy.unlockRepo).toHaveBeenCalledWith(planId);
			expect(result).toEqual({ success: true, result: 'Unlocked successfully' });
		});

		it('should throw a NotFoundError if the plan does not exist', async () => {
			// Arrange
			mockPlanStore.getById.mockResolvedValue(null);

			// Act & Assert
			await expect(planService.unlockRepo(planId)).rejects.toThrow(
				`Plan with ID ${planId} not found.`
			);
			await expect(planService.unlockRepo(planId)).rejects.toHaveProperty('statusCode', 404);
		});

		it('should propagate the result from the strategy if it fails', async () => {
			// Arrange
			mockPlanStore.getById.mockResolvedValue(mockPlan);
			mockStrategy.unlockRepo = jest
				.fn()
				.mockResolvedValue({ success: false, result: 'Strategy failed to unlock' });

			// Act
			const result = await planService.unlockRepo(planId);

			// Assert
			expect(mockStrategy.unlockRepo).toHaveBeenCalledWith(planId);
			expect(result).toEqual({ success: false, result: 'Strategy failed to unlock' });
		});
	});

	// --------------------------------------------
	// Tests for getStorageDetails (private method)
	// --------------------------------------------

	describe('getStorageDetails (private method)', () => {
		const storageId = 'storage-123';
		const mockStorage = {
			id: storageId,
			name: 'My S3 Storage',
			type: 's3',
			authType: 'client',
			settings: { region: 'us-east-1' },
			credentials: { accessKey: 'abc', secretKey: 'xyz' },
			defaultPath: '/default',
		} as any;

		it('should return formatted storage details when a valid ID is provided', async () => {
			// Arrange
			mockStorageStore.getById.mockResolvedValue(mockStorage);

			// Act
			// Use array-bracket notation to bypass TypeScript's private access modifier.
			// This is a standard and accepted practice for testing private methods.
			const result = await (planService as any).getStorageDetails(storageId);

			// Assert
			expect(mockStorageStore.getById).toHaveBeenCalledWith(storageId);
			expect(result).toEqual({
				name: 'My S3 Storage',
				type: 's3',
				authType: 'client',
				settings: { region: 'us-east-1' },
				credentials: { accessKey: 'abc', secretKey: 'xyz' },
				defaultPath: '/default',
			});
		});

		it('should correctly handle a storage type of "local"', async () => {
			// Arrange
			const localMockStorage = {
				...mockStorage,
				id: 'local',
				name: 'Local Storage',
				type: 'local',
			};
			mockStorageStore.getById.mockResolvedValue(localMockStorage);

			// Act
			const result = await (planService as any).getStorageDetails('local');

			// Assert
			expect(result.name).toBe('local'); // Special case for local storage name
		});

		it('should throw a NotFoundError if the storage does not exist', async () => {
			// Arrange
			mockStorageStore.getById.mockResolvedValue(null);

			// Act & Assert
			// We wrap the call in an async function to use with `rejects`.
			const privateMethodCall = async () => await (planService as any).getStorageDetails(storageId);

			// First, check for the correct error message.
			await expect(privateMethodCall()).rejects.toThrow('Storage not found');

			// Then, check for the correct status code, which is the defining feature of a NotFoundError.
			await expect(privateMethodCall()).rejects.toHaveProperty('statusCode', 404);
		});
	});
});
