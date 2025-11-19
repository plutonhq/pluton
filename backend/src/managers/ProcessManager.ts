import { ChildProcessWithoutNullStreams, ChildProcess } from 'child_process';

export class ProcessManager {
	private processes = new Map<string, ChildProcess>();

	trackProcess(id: string, process: ChildProcess) {
		this.processes.set(id, process);
	}

	killProcess(id: string) {
		const process = this.processes.get(id);
		if (process) {
			// Use SIGTERM signal for graceful termination
			process.kill('SIGTERM');
			this.processes.delete(id);
			return true;
		}
		return false;
	}

	getProcess(id: string) {
		return this.processes.get(id);
	}
}

// Create a single instance to be used across the application
export const processManager = new ProcessManager();
