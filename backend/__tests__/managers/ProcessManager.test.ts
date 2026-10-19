import { processManager } from '../../src/managers/ProcessManager';
import { ChildProcess } from 'child_process';
import { killProcessTree } from '../../src/utils/processTree';

jest.mock('../../src/utils/processTree', () => ({
	killProcessTree: jest.fn(),
}));

const mockKillProcessTree = killProcessTree as jest.MockedFunction<typeof killProcessTree>;

// Create a mock ChildProcess object for testing purposes.
// We only need a `kill` method that is a jest spy.
const createMockProcess = (): jest.Mocked<Pick<ChildProcess, 'kill'>> => {
	return {
		kill: jest.fn(),
	};
};

describe('ProcessManager', () => {
	// Before each test, we clear the internal `processes` map of the singleton
	// to ensure that tests do not interfere with each other.
	beforeEach(() => {
		// Accessing a private property for testing is a common and acceptable practice.
		(processManager as any).processes.clear();
		jest.clearAllMocks();
	});

	describe('trackProcess and getProcess', () => {
		it('should correctly track a new process', () => {
			// Arrange
			const mockProcess = createMockProcess() as unknown as ChildProcess;
			const processId = 'backup-123';

			// Act
			processManager.trackProcess(processId, mockProcess);

			// Assert
			const retrievedProcess = processManager.getProcess(processId);
			expect(retrievedProcess).toBe(mockProcess);
		});

		it('should track multiple different processes', () => {
			// Arrange
			const mockProcess1 = createMockProcess() as unknown as ChildProcess;
			const mockProcess2 = createMockProcess() as unknown as ChildProcess;

			// Act
			processManager.trackProcess('proc-1', mockProcess1);
			processManager.trackProcess('proc-2', mockProcess2);

			// Assert
			expect(processManager.getProcess('proc-1')).toBe(mockProcess1);
			expect(processManager.getProcess('proc-2')).toBe(mockProcess2);
		});

		it('should overwrite an existing process if the same ID is used', () => {
			// Arrange
			const oldProcess = createMockProcess() as unknown as ChildProcess;
			const newProcess = createMockProcess() as unknown as ChildProcess;
			const processId = 'proc-overwrite';

			// Act
			processManager.trackProcess(processId, oldProcess);
			processManager.trackProcess(processId, newProcess);

			// Assert
			const retrievedProcess = processManager.getProcess(processId);
			expect(retrievedProcess).toBe(newProcess);
			expect(retrievedProcess).not.toBe(oldProcess);
		});

		it('should return undefined when getting a non-existent process', () => {
			// Arrange (no processes are tracked)

			// Act
			const retrievedProcess = processManager.getProcess('non-existent-id');

			// Assert
			expect(retrievedProcess).toBeUndefined();
		});
	});

	describe('killProcess', () => {
		it('should kill the whole process tree with SIGTERM', () => {
			// Arrange
			const mockProcess = createMockProcess() as unknown as ChildProcess;
			const processId = 'process-to-kill';
			processManager.trackProcess(processId, mockProcess);

			// Act
			processManager.killProcess(processId);

			// Assert
			expect(mockKillProcessTree).toHaveBeenCalledTimes(1);
			expect(mockKillProcessTree).toHaveBeenCalledWith(mockProcess, 'SIGTERM');
		});

		it('should remove the process from tracking after killing it', () => {
			// Arrange
			const mockProcess = createMockProcess() as unknown as ChildProcess;
			const processId = 'process-to-remove';
			processManager.trackProcess(processId, mockProcess);

			// Act
			processManager.killProcess(processId);

			// Assert
			const retrievedProcess = processManager.getProcess(processId);
			expect(retrievedProcess).toBeUndefined();
		});

		it('should return true if the process was found and killed', () => {
			// Arrange
			// FIX: Apply the type assertion here as well.
			const mockProcess = createMockProcess() as unknown as ChildProcess;
			const processId = 'successful-kill';
			processManager.trackProcess(processId, mockProcess);

			// Act
			const result = processManager.killProcess(processId);

			// Assert
			expect(result).toBe(true);
		});

		it('should return false if the process ID does not exist', () => {
			// Arrange (no processes tracked)

			// Act
			const result = processManager.killProcess('non-existent-id');

			// Assert
			expect(result).toBe(false);
		});

		it('should not throw an error when trying to kill a non-existent process', () => {
			// Arrange (no processes tracked)

			// Act & Assert
			expect(() => processManager.killProcess('non-existent-id')).not.toThrow();
		});
	});

	describe('killAll', () => {
		it('should kill every tracked process and clear the map', () => {
			// Arrange
			const mockProcess1 = createMockProcess() as unknown as ChildProcess;
			const mockProcess2 = createMockProcess() as unknown as ChildProcess;
			processManager.trackProcess('proc-1', mockProcess1);
			processManager.trackProcess('proc-2', mockProcess2);

			// Act
			processManager.killAll();

			// Assert
			expect(mockKillProcessTree).toHaveBeenCalledTimes(2);
			expect(mockKillProcessTree).toHaveBeenCalledWith(mockProcess1, 'SIGTERM');
			expect(mockKillProcessTree).toHaveBeenCalledWith(mockProcess2, 'SIGTERM');
			expect(processManager.getProcess('proc-1')).toBeUndefined();
			expect(processManager.getProcess('proc-2')).toBeUndefined();
		});

		it('should not throw when no processes are tracked', () => {
			expect(() => processManager.killAll()).not.toThrow();
		});

		it('force-stops newly tracked recovery cleanup groups at the shutdown deadline', () => {
			const initial = createMockProcess() as unknown as ChildProcess;
			const cleanup = createMockProcess() as unknown as ChildProcess;
			processManager.trackProcess('recovery-import', initial);
			processManager.killAll();
			processManager.trackProcess('recovery-cleanup', cleanup);

			processManager.killAll('SIGKILL');

			expect(mockKillProcessTree).toHaveBeenCalledWith(initial, 'SIGTERM');
			expect(mockKillProcessTree).toHaveBeenCalledWith(cleanup, 'SIGKILL');
			expect(processManager.getProcess('recovery-cleanup')).toBeUndefined();
		});
	});
});
