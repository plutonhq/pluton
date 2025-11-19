import { PlanStore } from '../../src/stores/PlanStore';
import { DatabaseType } from '../../src/db';
import { NewPlan, Plan } from '../../src/db/schema/plans';
import { PlanFull } from '../../src/types/plans';

// Mock the configService to provide a consistent secret for encryption/decryption tests
jest.mock('#core-backend/services/ConfigService', () => ({
	configService: {
		config: {
			SECRET: 'a-test-secret-key-that-is-long-enough',
		},
	},
}));

describe('PlanStore', () => {
	let planStore: PlanStore;
	let mockDb: any; // Using `any` for easier mocking

	// --- Mock Data ---
	const mockPlans: PlanFull[] = [
		{
			id: 'plan-1',
			title: 'Website Backup',
			isActive: true,
			method: 'backup',
			sourceId: 'main',
			stats: { size: 5000, snapshots: ['backup-1a', 'backup-1b'] },
			backups: [
				{ id: 'backup-1a', status: 'completed', taskStats: { total_bytes_processed: 2500 } },
				{ id: 'backup-1b', status: 'completed', taskStats: { total_bytes_processed: 2500 } },
			],
			settings: {
				scripts: {
					onBackupStart: [{ id: 's1', command: 'echo "start"' }],
				},
			},
		} as any,
		{
			id: 'plan-2',
			title: 'Database Sync',
			isActive: false,
			method: 'sync',
			sourceId: 'remote-1',
			stats: { size: 1000, snapshots: ['backup-2a'] },
			backups: [{ id: 'backup-2a', status: 'failed', taskStats: { total_bytes_processed: 1000 } }],
			settings: {},
		} as any,
	];

	beforeEach(() => {
		jest.clearAllMocks();

		// Mock the complex, chained Drizzle query builders
		const updateQueryBuilder = {
			set: jest.fn().mockReturnThis(),
			where: jest.fn().mockReturnThis(),
			returning: jest.fn(),
		};
		const deleteQueryBuilder = {
			where: jest.fn(),
		};
		const selectQueryBuilder = {
			from: jest.fn().mockReturnThis(),
			where: jest.fn().mockReturnThis(),
			limit: jest.fn(),
		};

		mockDb = {
			query: {
				plans: {
					findMany: jest.fn(),
					findFirst: jest.fn(),
				},
				backups: {
					findMany: jest.fn(),
				},
			},
			insert: jest.fn().mockReturnValue({
				values: jest.fn().mockReturnThis(),
				returning: jest.fn(),
			}),
			update: jest.fn().mockReturnValue(updateQueryBuilder),
			delete: jest.fn().mockReturnValue(deleteQueryBuilder),
			select: jest.fn().mockReturnValue(selectQueryBuilder),
		};

		planStore = new PlanStore(mockDb as DatabaseType);

		jest.spyOn(planStore, 'decryptScripts').mockImplementation(async scripts => scripts);
		jest.spyOn(planStore, 'encryptScripts').mockImplementation(async scripts => scripts);
	});

	describe('getAll', () => {
		it('should retrieve all plans with full history by default', async () => {
			// Arrange
			mockDb.query.plans.findMany.mockResolvedValue(mockPlans);

			// Act
			await planStore.getAll();

			// Assert
			expect(mockDb.query.plans.findMany).toHaveBeenCalledWith(
				expect.objectContaining({
					with: expect.objectContaining({
						backups: expect.objectContaining({ limit: 90 }),
						restores: expect.objectContaining({ limit: 90 }),
					}),
				})
			);
		});

		it('should limit history when history is false', async () => {
			// Arrange
			mockDb.query.plans.findMany.mockResolvedValue(mockPlans);

			// Act
			await planStore.getAll(false);

			// Assert
			expect(mockDb.query.plans.findMany).toHaveBeenCalledWith(
				expect.objectContaining({
					with: expect.objectContaining({
						backups: expect.objectContaining({ limit: 10 }),
						restores: expect.objectContaining({ limit: 0 }),
					}),
				})
			);
		});

		it('should decrypt scripts when retrieving plans', async () => {
			// Arrange
			mockDb.query.plans.findMany.mockResolvedValue(mockPlans);

			// Act
			await planStore.getAll();

			// Assert
			// We just need to confirm the method was called. The spy is set up in beforeEach.
			expect(planStore.decryptScripts).toHaveBeenCalledWith(mockPlans[0].settings.scripts);
		});
	});

	describe('getById', () => {
		it('should retrieve a single plan by ID', async () => {
			// Arrange
			mockDb.query.plans.findFirst.mockResolvedValue(mockPlans[0]);

			// Act
			const result = await planStore.getById('plan-1');

			// Assert
			expect(mockDb.query.plans.findFirst).toHaveBeenCalledWith(expect.any(Object));
			expect(result).toEqual(expect.objectContaining({ id: 'plan-1' }));
		});
	});

	describe('handleBackupStats', () => {
		it('should correctly calculate derived stats for each backup', () => {
			// Arrange
			const backups = [
				{
					id: 'backup-1a',
					started: new Date('2023-01-01T10:00:00Z'),
					ended: new Date('2023-01-01T10:01:30Z'),
					taskStats: {
						total_files_processed: 10,
						total_bytes_processed: 1024,
						files_new: 1,
						dirs_new: 1,
						files_changed: 2,
						dirs_changed: 0,
					},
				},
				{
					id: 'backup-1c',
					started: new Date('2023-01-01T11:00:00Z'),
					ended: new Date('2023-01-01T11:02:00Z'),
					taskStats: {
						total_files_processed: 5,
						total_bytes_processed: 512,
						files_new: 0,
						dirs_new: 0,
						files_changed: 0,
						dirs_changed: 0,
					},
				},
			] as any[];
			const planStats = { size: 1536, snapshots: ['backup-1a'] };

			// Act
			const result = planStore.handleBackupStats('backup', backups, planStats);

			// Assert
			expect(result).toHaveLength(2);
			// Check first backup
			expect(result[0].totalFiles).toBe(10);
			expect(result[0].totalSize).toBe(1024);
			expect(result[0].duration).toBe(90);
			expect(result[0].active).toBe(true);
			expect(result[0].changes).toEqual({ new: 2, modified: 2, removed: 0 });
			// Check second backup (not in snapshots)
			expect(result[1].active).toBe(false);
		});
	});

	describe('create', () => {
		it('should insert a new plan with default values', async () => {
			// Arrange
			const newPlanData: NewPlan = {
				id: 'plan-3',
				title: 'New Plan',
				sourceId: 'main',
				method: 'backup',
				sourceType: 'device',
				sourceConfig: { includes: ['/data'], excludes: [] },
				settings: {
					compression: false,
					encryption: true,
					retries: 5,
					retryDelay: 300,
					interval: { type: 'daily', time: '10:00AM' },
					prune: { policy: 'none', snapCount: 1 },
					notification: {
						email: {
							enabled: false,
							case: 'failure',
							type: 'smtp',
							emails: '',
						},
						webhook: {
							enabled: false,
							case: 'failure',
							method: 'POST',
							contentType: 'application/json',
							url: '',
						},
						push: {
							enabled: false,
							url: '',
							case: 'failure',
							authType: 'none',
							authToken: '',
							tags: '',
						},
					},
					performance: {},
					integrity: {
						enabled: false,
						interval: { type: 'weekly', time: '10:00AM', days: 'sun', hours: '', minutes: 5 },
						method: 'no-read',
						notification: {
							email: {
								enabled: false,
								type: 'smtp',
								emails: '',
							},
							webhook: {
								enabled: false,
								method: 'POST',
								contentType: 'application/json',
								url: '',
							},
							push: {
								enabled: false,
								url: '',
								authType: 'none',
								authToken: '',
								tags: '',
							},
						},
					},
				},
			};
			mockDb.insert().returning.mockResolvedValue([newPlanData]);

			// Act
			await planStore.create(newPlanData);

			// Assert
			expect(mockDb.insert().values).toHaveBeenCalledWith(
				expect.objectContaining({
					...newPlanData,
					isActive: true,
					stats: { size: 0, snapshots: [] },
				})
			);
		});
	});

	describe('update', () => {
		it('should update only allowed fields', async () => {
			// Arrange
			const updates = { title: 'New Title', isActive: false, id: 'should-not-be-updated' };
			mockDb.update().returning.mockResolvedValue([{}]);

			// Act
			await planStore.update('plan-1', updates);

			// Assert
			const setPayload = mockDb.update().set.mock.calls[0][0];
			expect(setPayload.title).toBe('New Title');
			expect(setPayload.isActive).toBe(false);
			expect(setPayload.id).toBeUndefined(); // Crucial check
		});

		it('should encrypt scripts before updating', async () => {
			// Arrange
			const encryptSpy = jest
				.spyOn(planStore, 'encryptScripts')
				.mockResolvedValue({ onBackupStart: [{ id: 's1', command: 'encrypted-command' }] } as any);
			const updates = {
				settings: { scripts: { onBackupStart: [{ id: 's1', command: 'decrypted' }] } },
			};
			mockDb.update().returning.mockResolvedValue([{}]);

			// Act
			await planStore.update('plan-1', updates as any);

			// Assert
			expect(encryptSpy).toHaveBeenCalled();
			const setPayload = mockDb.update().set.mock.calls[0][0];
			expect(setPayload.settings.scripts.onBackupStart[0].command).toBe('encrypted-command');
		});
	});

	describe('delete', () => {
		it('should return true if a plan is deleted', async () => {
			// Arrange
			mockDb.delete().where.mockResolvedValue({ changes: 1 });

			// Act
			const result = await planStore.delete('plan-1');

			// Assert
			expect(result).toBe(true);
		});
	});

	describe('hasActiveBackups', () => {
		it('should return true if active backups are found', async () => {
			// Arrange
			mockDb.select().limit.mockResolvedValue([{ id: 'backup-xyz' }]);

			// Act
			const result = await planStore.hasActiveBackups('plan-1');

			// Assert
			expect(mockDb.select().where).toHaveBeenCalled();
			expect(result).toBe(true);
		});

		it('should return false if no active backups are found', async () => {
			// Arrange
			mockDb.select().limit.mockResolvedValue([]);

			// Act
			const result = await planStore.hasActiveBackups('plan-1');

			// Assert
			expect(result).toBe(false);
		});
	});

	describe('setActive', () => {
		it('should call the update method with the correct payload', async () => {
			// Arrange
			const updateSpy = jest.spyOn(planStore, 'update').mockResolvedValue(null);

			// Act
			await planStore.setActive('plan-1', false);

			// Assert
			expect(updateSpy).toHaveBeenCalledWith('plan-1', { isActive: false });

			// Clean up spy
			updateSpy.mockRestore();
		});
	});

	describe('encryptScripts and decryptScripts (real implementation)', () => {
		// This block ensures the original methods are restored ONLY for the test(s) inside this describe.
		beforeEach(() => {
			(planStore.encryptScripts as jest.Mock).mockRestore();
			(planStore.decryptScripts as jest.Mock).mockRestore();
		});

		it('should correctly encrypt and then decrypt script commands', async () => {
			// Arrange
			const originalScripts = {
				onBackupStart: [{ id: 's1', command: 'echo "hello world"' }],
				onBackupEnd: [{ id: 's2', command: '/usr/bin/my_script.sh' }],
			};

			// Act
			const encrypted = await planStore.encryptScripts(originalScripts as any);
			const decrypted = await planStore.decryptScripts(encrypted);

			// Assert
			expect(encrypted!.onBackupStart![0].command).not.toBe('echo "hello world"');
			expect(encrypted!.onBackupEnd![0].command).not.toBe('/usr/bin/my_script.sh');
			expect(decrypted).toEqual(originalScripts);
		});
	});
});
