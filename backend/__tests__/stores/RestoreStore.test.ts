import { RestoreStore } from '../../src/stores/RestoreStore';
import { DatabaseType } from '../../src/db';
import { Restore, NewRestore } from '../../src/db/schema/restores';

describe('RestoreStore', () => {
	let restoreStore: RestoreStore;
	let mockDb: any; // Using `any` for easier mocking of the complex Drizzle type

	// Mock data for tests
	const mockRestores: Restore[] = [
		{
			id: 'restore-1',
			planId: 'plan-a',
			backupId: 'backup-1',
			status: 'completed',
			inProgress: false,
			sourceId: 'main',
			sourceType: 'device',
			method: 'backup',
			createdAt: new Date(),
			started: new Date(),
			ended: new Date(),
			updatedAt: null,
			errorMsg: null,
			storageId: 'storage-1',
			config: null,
			taskStats: null,
			progressStats: null,
			completionStats: null,
		},
		{
			id: 'restore-2',
			planId: 'plan-b',
			backupId: 'backup-2',
			status: 'in_progress',
			inProgress: true,
			sourceId: 'main',
			sourceType: 'device',
			method: 'backup',
			createdAt: new Date(),
			started: new Date(),
			ended: null,
			updatedAt: null,
			errorMsg: null,
			storageId: 'storage-2',
			config: null,
			taskStats: null,
			progressStats: null,
			completionStats: null,
		},
	];

	beforeEach(() => {
		jest.clearAllMocks();

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
				restores: {
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

		restoreStore = new RestoreStore(mockDb as DatabaseType);
	});

	describe('getAll', () => {
		it('should return all restores', async () => {
			// Arrange
			mockDb.query.restores.findMany.mockResolvedValue(mockRestores);

			// Act
			const result = await restoreStore.getAll();

			// Assert
			expect(mockDb.query.restores.findMany).toHaveBeenCalled();
			expect(result).toEqual(mockRestores);
		});

		it('should return null if no restores are found', async () => {
			// Arrange
			mockDb.query.restores.findMany.mockResolvedValue(null);

			// Act
			const result = await restoreStore.getAll();

			// Assert
			expect(result).toBeNull();
		});
	});

	describe('getById', () => {
		it('should return a single restore by its ID', async () => {
			// Arrange
			mockDb.query.restores.findFirst.mockResolvedValue(mockRestores[0]);

			// Act
			const result = await restoreStore.getById('restore-1');

			// Assert
			expect(mockDb.query.restores.findFirst).toHaveBeenCalledWith({
				where: expect.any(Object),
			});
			expect(result).toEqual(mockRestores[0]);
		});

		it('should return null for a non-existent ID', async () => {
			// Arrange
			mockDb.query.restores.findFirst.mockResolvedValue(null);

			// Act
			const result = await restoreStore.getById('non-existent-id');

			// Assert
			expect(result).toBeNull();
		});
	});

	describe('create', () => {
		it('should insert a new restore and return it', async () => {
			// Arrange
			const newRestoreData: NewRestore = {
				id: 'restore-3',
				planId: 'plan-c',
				backupId: 'backup-3',
				status: 'started',
				sourceId: 'main',
				sourceType: 'device',
				method: 'backup',
			};
			mockDb.insert().returning.mockResolvedValue([newRestoreData]);

			// Act
			const result = await restoreStore.create(newRestoreData);

			// Assert
			expect(mockDb.insert).toHaveBeenCalled();
			expect(mockDb.insert().values).toHaveBeenCalledWith(
				expect.objectContaining({
					...newRestoreData,
					started: expect.any(Object), // Drizzle sql object
				})
			);
			expect(result).toEqual(newRestoreData);
		});
	});

	describe('update', () => {
		it('should update a restore by ID and return the updated data', async () => {
			// Arrange
			const restoreId = 'restore-2';
			const updates = { status: 'completed', inProgress: false };
			const updatedRestore = { ...mockRestores[1], ...updates };
			mockDb.update().returning.mockResolvedValue([updatedRestore]);

			// Act
			const result = await restoreStore.update(restoreId, updates);

			// Assert
			expect(mockDb.update).toHaveBeenCalled();
			expect(mockDb.update().set).toHaveBeenCalledWith(
				expect.objectContaining({
					...updates,
					updatedAt: expect.any(Object),
					ended: expect.any(Object), // Should set `ended` timestamp
				})
			);
			expect(mockDb.update().where).toHaveBeenCalled();
			expect(result).toEqual(updatedRestore);
		});

		it('should update a restore by backupId if specified', async () => {
			// Arrange
			const backupId = 'backup-2';
			const updates = { status: 'cancelled', inProgress: false };
			mockDb.update().returning.mockResolvedValue([{ ...mockRestores[1], ...updates }]);

			// Act
			await restoreStore.update(backupId, updates, 'backupId');

			// Assert
			expect(mockDb.update().where).toHaveBeenCalled();
			// We can inspect the mock to ensure `eq(restores.backupId, id)` was effectively called
		});

		it('should not set the `ended` timestamp if status is not final', async () => {
			// Arrange
			const restoreId = 'restore-2';
			const updates = { status: 'retrying', inProgress: true };
			mockDb.update().returning.mockResolvedValue([{ ...mockRestores[1], ...updates }]);

			// Act
			await restoreStore.update(restoreId, updates);

			// Assert
			expect(mockDb.update().set).toHaveBeenCalledWith(
				expect.objectContaining({
					...updates,
					updatedAt: expect.any(Object),
					ended: null, // Should be null
				})
			);
		});
	});

	describe('isRestoreRunning', () => {
		it('should return true if a restore is in progress for the backup ID', async () => {
			// Arrange
			mockDb.query.restores.findFirst.mockResolvedValue(mockRestores[1]);

			// Act
			const result = await restoreStore.isRestoreRunning('backup-2');

			// Assert
			expect(mockDb.query.restores.findFirst).toHaveBeenCalledWith({
				where: expect.any(Object),
			});
			expect(result).toBe(true);
		});

		it('should return false if no restore is in progress for the backup ID', async () => {
			// Arrange
			mockDb.query.restores.findFirst.mockResolvedValue(null);

			// Act
			const result = await restoreStore.isRestoreRunning('backup-1');

			// Assert
			expect(result).toBe(false);
		});
	});

	describe('delete', () => {
		it('should delete a restore and return true on success', async () => {
			// Arrange
			mockDb.delete().where.mockResolvedValue({ changes: 1 });

			// Act
			const result = await restoreStore.delete('restore-1');

			// Assert
			expect(mockDb.delete).toHaveBeenCalled();
			expect(mockDb.delete().where).toHaveBeenCalled();
			expect(result).toBe(true);
		});

		it('should return false if no restore was deleted', async () => {
			// Arrange
			mockDb.delete().where.mockResolvedValue({ changes: 0 });

			// Act
			const result = await restoreStore.delete('non-existent-id');

			// Assert
			expect(result).toBe(false);
		});
	});
});
