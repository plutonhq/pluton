import { processManager } from '../../src/managers/ProcessManager';
import { ChildProcess } from 'child_process';

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
		it('should call the kill method on the specified process with SIGTERM', () => {
			// Arrange
			const mockProcess = createMockProcess() as unknown as ChildProcess;
			const processId = 'process-to-kill';
			processManager.trackProcess(processId, mockProcess);

			// Act
			processManager.killProcess(processId);

			// Assert
			expect(mockProcess.kill).toHaveBeenCalledTimes(1);
			expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
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
});
