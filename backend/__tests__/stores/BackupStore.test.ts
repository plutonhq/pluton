import { BackupStore } from '../../src/stores/BackupStore';
import { DatabaseType } from '../../src/db';
import { Backup, NewBackup } from '../../src/db/schema/backups';

describe('BackupStore', () => {
	let backupStore: BackupStore;
	let mockDb: any; // Using `any` for easier mocking of the complex Drizzle type

	// Mock data for tests
	const mockBackups: Backup[] = [
		{
			id: 'backup-1',
			planId: 'plan-a',
			status: 'completed',
			success: true,
			inProgress: false,
			sourceId: 'main',
			method: 'backup',
			sourceType: 'device',
			createdAt: new Date(),
			updatedAt: null,
			started: new Date(),
			ended: new Date(),
			active: true,
			errorMsg: null,
			storageId: 'storage-1',
			storagePath: '/backups/plan-a',
			sourceConfig: null,
			encryption: true,
			compression: false,
			download: null,
			taskStats: null,
			progressStats: null,
			completionStats: null,
		},
		{
			id: 'backup-2',
			planId: 'plan-b',
			status: 'failed',
			success: false,
			inProgress: false,
			sourceId: 'remote-1',
			method: 'backup',
			sourceType: 'device',
			createdAt: new Date(),
			updatedAt: null,
			started: new Date(),
			ended: new Date(),
			active: true,
			errorMsg: 'Connection timed out',
			storageId: 'storage-2',
			storagePath: '/backups/plan-b',
			sourceConfig: null,
			encryption: true,
			compression: false,
			download: null,
			taskStats: null,
			progressStats: null,
			completionStats: null,
		},
	];

	beforeEach(() => {
		jest.clearAllMocks();

		// Set up mocks for Drizzle's chained query builders
		const updateQueryBuilder = {
			set: jest.fn().mockReturnThis(),
			where: jest.fn().mockReturnThis(),
			returning: jest.fn(),
		};
		const deleteQueryBuilder = {
			where: jest.fn(),
		};

		mockDb = {
			query: {
				backups: {
					findMany: jest.fn(),
					findFirst: jest.fn(),
				},
			},
			insert: jest.fn().mockReturnValue({
				values: jest.fn().mockReturnThis(),
				returning: jest.fn(),
			}),
			update: jest.fn().mockReturnValue(updateQueryBuilder),
			delete: jest.fn().mockReturnValue(deleteQueryBuilder),
		};

		backupStore = new BackupStore(mockDb as DatabaseType);
	});

	describe('getAll', () => {
		it('should return all backups', async () => {
			// Arrange
			mockDb.query.backups.findMany.mockResolvedValue(mockBackups);

			// Act
			const result = await backupStore.getAll();

			// Assert
			expect(mockDb.query.backups.findMany).toHaveBeenCalled();
			expect(result).toEqual(mockBackups);
		});

		it('should return null if the database query returns null', async () => {
			// Arrange
			mockDb.query.backups.findMany.mockResolvedValue(null);

			// Act
			const result = await backupStore.getAll();

			// Assert
			expect(result).toBeNull();
		});
	});

	describe('getById', () => {
		it('should return a single backup by its ID', async () => {
			// Arrange
			mockDb.query.backups.findFirst.mockResolvedValue(mockBackups[0]);

			// Act
			const result = await backupStore.getById('backup-1');

			// Assert
			expect(mockDb.query.backups.findFirst).toHaveBeenCalledWith({
				where: expect.any(Object),
			});
			expect(result).toEqual(mockBackups[0]);
		});

		it('should return null for a non-existent ID', async () => {
			// Arrange
			mockDb.query.backups.findFirst.mockResolvedValue(null);

			// Act
			const result = await backupStore.getById('non-existent-id');

			// Assert
			expect(result).toBeNull();
		});
	});

	describe('create', () => {
		it('should insert a new backup and return it', async () => {
			// Arrange
			const newBackupData: NewBackup = {
				id: 'backup-3',
				planId: 'plan-c',
				status: 'started',
				sourceId: 'main',
				method: 'backup',
				sourceType: 'device',
			};
			mockDb.insert().returning.mockResolvedValue([newBackupData]);

			// Act
			const result = await backupStore.create(newBackupData);

			// Assert
			expect(mockDb.insert).toHaveBeenCalled();
			expect(mockDb.insert().values).toHaveBeenCalledWith(
				expect.objectContaining({
					...newBackupData,
					createdAt: expect.any(Object), // Drizzle sql object
					started: expect.any(Object), // Drizzle sql object
				})
			);
			expect(result).toEqual(newBackupData);
		});
	});

	describe('update', () => {
		it('should update a backup and return the updated data', async () => {
			// Arrange
			const backupId = 'backup-1';
			const updates = { status: 'completed', success: true };
			const updatedBackup = { ...mockBackups[0], ...updates };
			mockDb.update().returning.mockResolvedValue([updatedBackup]);

			// Act
			const result = await backupStore.update(backupId, updates);

			// Assert
			expect(mockDb.update).toHaveBeenCalled();
			expect(mockDb.update().set).toHaveBeenCalledWith(
				expect.objectContaining({
					...updates,
					updatedAt: expect.any(Object), // Drizzle sql object
				})
			);
			expect(mockDb.update().where).toHaveBeenCalled();
			expect(result).toEqual(updatedBackup);
		});
	});

	describe('delete', () => {
		it('should delete a backup and return true on success', async () => {
			// Arrange
			mockDb.delete().where.mockResolvedValue({ changes: 1 });

			// Act
			const result = await backupStore.delete('backup-1');

			// Assert
			expect(mockDb.delete).toHaveBeenCalled();
			expect(mockDb.delete().where).toHaveBeenCalled();
			expect(result).toBe(true);
		});

		it('should return false if no backup was deleted', async () => {
			// Arrange
			mockDb.delete().where.mockResolvedValue({ changes: 0 });

			// Act
			const result = await backupStore.delete('non-existent-id');

			// Assert
			expect(result).toBe(false);
		});
	});

	describe('deleteByPlanId', () => {
		it('should delete all backups associated with a plan ID and return true', async () => {
			// Arrange
			mockDb.delete().where.mockResolvedValue({ changes: 5 }); // Assume 5 backups were deleted

			// Act
			const result = await backupStore.deleteByPlanId('plan-a');

			// Assert
			expect(mockDb.delete).toHaveBeenCalled();
			expect(mockDb.delete().where).toHaveBeenCalledWith(expect.any(Object));
			expect(result).toBe(true);
		});

		it('should return false if no backups were found for the plan ID', async () => {
			// Arrange
			mockDb.delete().where.mockResolvedValue({ changes: 0 });

			// Act
			const result = await backupStore.deleteByPlanId('plan-with-no-backups');

			// Assert
			expect(result).toBe(false);
		});
	});
});
