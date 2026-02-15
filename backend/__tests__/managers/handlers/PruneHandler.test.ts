// Mocks
const mockRunResticCommand = jest.fn();
const mockGetBackupPlanStats = jest.fn();
const mockGenerateResticRepoPath = jest.fn();

jest.mock('../../../src/utils/restic/restic', () => ({
	runResticCommand: (...args: any[]) => mockRunResticCommand(...args),
	getBackupPlanStats: (...args: any[]) => mockGetBackupPlanStats(...args),
}));

jest.mock('../../../src/utils/restic/helpers', () => ({
	generateResticRepoPath: (...args: any[]) => mockGenerateResticRepoPath(...args),
}));

jest.mock('../../../src/services/ConfigService', () => ({
	configService: {
		config: {
			ENCRYPTION_KEY: 'test-key',
		},
	},
}));

import { EventEmitter } from 'events';
import { PruneHandler } from '../../../src/managers/handlers/PruneHandler';

describe('PruneHandler', () => {
	let handler: PruneHandler;
	let emitter: EventEmitter;

	const baseOptions = {
		storage: { name: 'test-storage', type: 'rclone' },
		storagePath: 'backups/test',
		settings: {
			encryption: true,
			prune: {
				policy: 'custom',
				keepDailySnaps: 7,
				keepWeeklySnaps: 4,
				keepMonthlySnaps: 12,
				snapCount: 50,
			},
		},
	};

	beforeEach(() => {
		jest.clearAllMocks();
		emitter = new EventEmitter();
		handler = new PruneHandler(emitter);

		// Default mock implementations
		mockRunResticCommand.mockResolvedValue('{"message_type":"summary"}');
		mockGetBackupPlanStats.mockResolvedValue({
			total_size: 500000,
			total_file_count: 50,
			snapshots_count: 10,
		});
		mockGenerateResticRepoPath.mockReturnValue('rclone:test-storage:backups/test');

		process.env.ENCRYPTION_KEY = 'test-key';
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	describe('prune', () => {
		it('should successfully prune with custom policy and snap count', async () => {
			const pruneEndListener = jest.fn();
			emitter.on('pruneEnd', pruneEndListener);

			const result = await handler.prune('plan-1', baseOptions, false);

			expect(result.success).toBe(true);
			expect(result.result).toBe('Pruned Old Snapshots Successfully.');

			// Should call runResticCommand twice: once for policy, once for snapCount
			expect(mockRunResticCommand).toHaveBeenCalledTimes(2);

			// First call: policy prune
			expect(mockRunResticCommand).toHaveBeenNthCalledWith(
				1,
				expect.arrayContaining([
					'forget',
					'--prune',
					'--tag',
					'plan-plan-1',
					'--keep-daily',
					'7',
					'--keep-weekly',
					'4',
					'--keep-monthly',
					'12',
				]),
				expect.objectContaining({ RESTIC_PASSWORD: 'test-key' })
			);

			// Second call: snap count prune
			expect(mockRunResticCommand).toHaveBeenNthCalledWith(
				2,
				expect.arrayContaining(['--keep-last', '50']),
				expect.objectContaining({ RESTIC_PASSWORD: 'test-key' })
			);

			expect(pruneEndListener).toHaveBeenCalledWith({
				planId: 'plan-1',
				success: true,
				stats: undefined,
			});
		});

		it('should successfully prune with custom policy without snap count', async () => {
			const optionsWithoutSnapCount = {
				...baseOptions,
				settings: {
					...baseOptions.settings,
					prune: {
						policy: 'custom',
						keepDailySnaps: 7,
						keepWeeklySnaps: 4,
						keepMonthlySnaps: 12,
					},
				},
			};

			const result = await handler.prune('plan-1', optionsWithoutSnapCount, false);

			expect(result.success).toBe(true);
			expect(mockRunResticCommand).toHaveBeenCalledTimes(1);
		});

		it('should successfully prune with forgetByAge policy', async () => {
			const optionsWithAge = {
				...baseOptions,
				settings: {
					encryption: true,
					prune: {
						policy: 'forgetByAge',
						forgetAge: '30d',
					},
				},
			};

			const result = await handler.prune('plan-1', optionsWithAge, false);

			expect(result.success).toBe(true);
			expect(mockRunResticCommand).toHaveBeenCalledWith(
				expect.arrayContaining(['forget', '--prune', '--keep-within', '30d']),
				expect.any(Object)
			);
		});

		it('should successfully prune with forgetByDate policy', async () => {
			const optionsWithDate = {
				...baseOptions,
				settings: {
					encryption: true,
					prune: {
						policy: 'forgetByDate',
						forgetDate: '2024-01-01',
					},
				},
			};

			const result = await handler.prune('plan-1', optionsWithDate, false);

			expect(result.success).toBe(true);
			expect(mockRunResticCommand).toHaveBeenCalledWith(
				expect.arrayContaining(['forget', '--prune', '--keep-before', '2024-01-01']),
				expect.any(Object)
			);
		});

		it('should update stats when updateStats is true', async () => {
			const pruneEndListener = jest.fn();
			emitter.on('pruneEnd', pruneEndListener);

			const result = await handler.prune('plan-1', baseOptions, true);

			expect(result.success).toBe(true);
			expect(mockGetBackupPlanStats).toHaveBeenCalledWith(
				'plan-1',
				'test-storage',
				'backups/test',
				true
			);
			expect(pruneEndListener).toHaveBeenCalledWith({
				planId: 'plan-1',
				success: true,
				stats: {
					total_size: 500000,
					total_file_count: 50,
					snapshots_count: 10,
				},
			});
		});

		it('should not update stats when updateStats is false', async () => {
			const result = await handler.prune('plan-1', baseOptions, false);

			expect(result.success).toBe(true);
			expect(mockGetBackupPlanStats).not.toHaveBeenCalled();
		});

		it('should handle prune errors gracefully', async () => {
			const pruneEndListener = jest.fn();
			emitter.on('pruneEnd', pruneEndListener);

			mockRunResticCommand.mockRejectedValueOnce(new Error('Prune failed'));

			const result = await handler.prune('plan-1', baseOptions, false);

			expect(result.success).toBe(false);
			expect(result.result).toBe('Prune failed');
			expect(pruneEndListener).toHaveBeenCalledWith({
				planId: 'plan-1',
				success: false,
				error: 'Prune failed',
			});
		});

		it('should handle unknown errors', async () => {
			const pruneEndListener = jest.fn();
			emitter.on('pruneEnd', pruneEndListener);

			mockRunResticCommand.mockRejectedValueOnce(null);

			const result = await handler.prune('plan-1', baseOptions, false);

			expect(result.success).toBe(false);
			expect(result.result).toBe('Unknown Error');
			expect(pruneEndListener).toHaveBeenCalledWith({
				planId: 'plan-1',
				success: false,
				error: 'Unknown Error',
			});
		});

		it('should work without encryption', async () => {
			const optionsNoEncryption = {
				...baseOptions,
				settings: {
					encryption: false,
					prune: {
						policy: 'custom',
						keepDailySnaps: 7,
					},
				},
			};

			const result = await handler.prune('plan-1', optionsNoEncryption, false);

			expect(result.success).toBe(true);
			expect(mockRunResticCommand).toHaveBeenCalledWith(
				expect.arrayContaining(['--insecure-no-password']),
				expect.objectContaining({ RESTIC_PASSWORD: '' })
			);
		});

		it('should handle custom policy with only daily snapshots', async () => {
			const optionsOnlyDaily = {
				...baseOptions,
				settings: {
					encryption: true,
					prune: {
						policy: 'custom',
						keepDailySnaps: 10,
					},
				},
			};

			const result = await handler.prune('plan-1', optionsOnlyDaily, false);

			expect(result.success).toBe(true);
			expect(mockRunResticCommand).toHaveBeenCalledWith(
				expect.arrayContaining(['--keep-daily', '10']),
				expect.any(Object)
			);

			const call = mockRunResticCommand.mock.calls[0][0];
			expect(call).not.toContain('--keep-weekly');
			expect(call).not.toContain('--keep-monthly');
		});

		it('should handle custom policy with only weekly snapshots', async () => {
			const optionsOnlyWeekly = {
				...baseOptions,
				settings: {
					encryption: true,
					prune: {
						policy: 'custom',
						keepWeeklySnaps: 8,
					},
				},
			};

			const result = await handler.prune('plan-1', optionsOnlyWeekly, false);

			expect(result.success).toBe(true);
			expect(mockRunResticCommand).toHaveBeenCalledWith(
				expect.arrayContaining(['--keep-weekly', '8']),
				expect.any(Object)
			);
		});

		it('should handle custom policy with only monthly snapshots', async () => {
			const optionsOnlyMonthly = {
				...baseOptions,
				settings: {
					encryption: true,
					prune: {
						policy: 'custom',
						keepMonthlySnaps: 6,
					},
				},
			};

			const result = await handler.prune('plan-1', optionsOnlyMonthly, false);

			expect(result.success).toBe(true);
			expect(mockRunResticCommand).toHaveBeenCalledWith(
				expect.arrayContaining(['--keep-monthly', '6']),
				expect.any(Object)
			);
		});

		it('should include JSON flag in all prune commands', async () => {
			const result = await handler.prune('plan-1', baseOptions, false);

			expect(result.success).toBe(true);

			// Check both calls include --json
			const firstCall = mockRunResticCommand.mock.calls[0][0];
			const secondCall = mockRunResticCommand.mock.calls[1][0];

			expect(firstCall).toContain('--json');
			expect(secondCall).toContain('--json');
		});

		it('should use correct repository path', async () => {
			await handler.prune('plan-1', baseOptions, false);

			expect(mockGenerateResticRepoPath).toHaveBeenCalledWith('test-storage', 'backups/test');
			expect(mockRunResticCommand).toHaveBeenCalledWith(
				expect.arrayContaining(['-r', 'rclone:test-storage:backups/test']),
				expect.any(Object)
			);
		});

		it('should use correct tag for plan', async () => {
			await handler.prune('plan-123', baseOptions, false);

			expect(mockRunResticCommand).toHaveBeenCalledWith(
				expect.arrayContaining(['--tag', 'plan-plan-123']),
				expect.any(Object)
			);
		});

		it('should handle empty storagePath', async () => {
			const optionsEmptyPath = {
				...baseOptions,
				storagePath: '',
			};

			await handler.prune('plan-1', optionsEmptyPath, false);

			expect(mockGenerateResticRepoPath).toHaveBeenCalledWith('test-storage', '');
		});

		it('should run policy prune before snapCount prune', async () => {
			const callOrder: string[] = [];

			mockRunResticCommand.mockImplementation((args: string[]) => {
				if (args.includes('--keep-last')) {
					callOrder.push('snapCount');
				} else {
					callOrder.push('policy');
				}
				return Promise.resolve('{}');
			});

			await handler.prune('plan-1', baseOptions, false);

			expect(callOrder).toEqual(['policy', 'snapCount']);
		});

		it('should handle stats update failure gracefully', async () => {
			const pruneEndListener = jest.fn();
			emitter.on('pruneEnd', pruneEndListener);

			mockGetBackupPlanStats.mockResolvedValueOnce(null);

			const result = await handler.prune('plan-1', baseOptions, true);

			expect(result.success).toBe(true);
			expect(pruneEndListener).toHaveBeenCalledWith({
				planId: 'plan-1',
				success: true,
				stats: null,
			});
		});

		it('should emit pruneEnd event on both success and failure', async () => {
			const pruneEndListener = jest.fn();
			emitter.on('pruneEnd', pruneEndListener);

			// Test success
			await handler.prune('plan-1', baseOptions, false);
			expect(pruneEndListener).toHaveBeenCalledWith({
				planId: 'plan-1',
				success: true,
				stats: undefined,
			});

			pruneEndListener.mockClear();

			// Test failure
			mockRunResticCommand.mockRejectedValueOnce(new Error('Test error'));
			await handler.prune('plan-2', baseOptions, false);
			expect(pruneEndListener).toHaveBeenCalledWith({
				planId: 'plan-2',
				success: false,
				error: 'Test error',
			});
		});
	});

	describe('generatePruneCommand', () => {
		it('should generate correct command for custom policy', () => {
			const result = handler['generatePruneCommand']('plan-1', baseOptions);

			expect(result.resticArgs).toContain('forget');
			expect(result.resticArgs).toContain('--prune');
			expect(result.resticArgs).toContain('--tag');
			expect(result.resticArgs).toContain('plan-plan-1');
			expect(result.resticArgs).toContain('-r');
			expect(result.resticArgs).toContain('rclone:test-storage:backups/test');
			expect(result.resticArgs).toContain('--json');

			expect(result.policyArgs).toContain('--keep-daily');
			expect(result.policyArgs).toContain('7');
			expect(result.policyArgs).toContain('--keep-weekly');
			expect(result.policyArgs).toContain('4');
			expect(result.policyArgs).toContain('--keep-monthly');
			expect(result.policyArgs).toContain('12');

			expect(result.resticEnv.RESTIC_PASSWORD).toBe('test-key');
		});

		it('should generate correct command for forgetByAge policy', () => {
			const optionsWithAge = {
				...baseOptions,
				settings: {
					encryption: true,
					prune: {
						policy: 'forgetByAge',
						forgetAge: '60d',
					},
				},
			};

			const result = handler['generatePruneCommand']('plan-1', optionsWithAge);

			expect(result.policyArgs).toContain('--keep-within');
			expect(result.policyArgs).toContain('60d');
		});

		it('should generate correct command for forgetByDate policy', () => {
			const optionsWithDate = {
				...baseOptions,
				settings: {
					encryption: true,
					prune: {
						policy: 'forgetByDate',
						forgetDate: '2023-12-31',
					},
				},
			};

			const result = handler['generatePruneCommand']('plan-1', optionsWithDate);

			expect(result.policyArgs).toContain('--keep-before');
			expect(result.policyArgs).toContain('2023-12-31');
		});

		it('should include insecure-no-password when encryption is false', () => {
			const optionsNoEncryption = {
				...baseOptions,
				settings: {
					encryption: false,
					prune: {
						policy: 'custom',
						keepDailySnaps: 5,
					},
				},
			};

			const result = handler['generatePruneCommand']('plan-1', optionsNoEncryption);

			expect(result.resticArgs).toContain('--insecure-no-password');
			expect(result.resticEnv.RESTIC_PASSWORD).toBe('');
		});

		it('should not include insecure-no-password when encryption is true', () => {
			const result = handler['generatePruneCommand']('plan-1', baseOptions);

			expect(result.resticArgs).not.toContain('--insecure-no-password');
		});

		it('should handle partial custom policy settings', () => {
			const partialOptions = {
				...baseOptions,
				settings: {
					encryption: true,
					prune: {
						policy: 'custom',
						keepDailySnaps: 5,
						// No weekly or monthly
					},
				},
			};

			const result = handler['generatePruneCommand']('plan-1', partialOptions);

			expect(result.policyArgs).toContain('--keep-daily');
			expect(result.policyArgs).toContain('5');
			expect(result.policyArgs).not.toContain('--keep-weekly');
			expect(result.policyArgs).not.toContain('--keep-monthly');
		});

		it('should handle missing storage name', () => {
			const optionsNoStorage = {
				...baseOptions,
				storage: { name: '', type: 'rclone' },
			};

			const result = handler['generatePruneCommand']('plan-1', optionsNoStorage);

			// Should not include -r flag if storage name is empty
			expect(result.resticArgs).not.toContain('-r');
		});

		it('should return empty policyArgs for unknown policy', () => {
			const optionsUnknownPolicy = {
				...baseOptions,
				settings: {
					encryption: true,
					prune: {
						policy: 'unknownPolicy',
					},
				},
			};

			const result = handler['generatePruneCommand']('plan-1', optionsUnknownPolicy);

			expect(result.policyArgs).toEqual([]);
		});

		it('should default encryption to true when not specified', () => {
			const optionsNoEncryptionField = {
				storage: { name: 'test-storage', type: 'rclone' },
				storagePath: 'backups/test',
				settings: {
					prune: {
						policy: 'custom',
						keepDailySnaps: 5,
					},
				},
			};

			const result = handler['generatePruneCommand']('plan-1', optionsNoEncryptionField);

			expect(result.resticEnv.RESTIC_PASSWORD).toBe('test-key');
			expect(result.resticArgs).not.toContain('--insecure-no-password');
		});
	});
});
