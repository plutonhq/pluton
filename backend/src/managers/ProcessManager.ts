import { ChildProcess } from 'child_process';
import { killProcessTree } from '../utils/processTree';

export class ProcessManager {
	private processes = new Map<string, ChildProcess>();

	trackProcess(id: string, process: ChildProcess) {
		this.processes.set(id, process);
	}

	untrackProcess(id: string) {
		this.processes.delete(id);
	}

	killProcess(id: string) {
		const process = this.processes.get(id);
		if (process) {
			killProcessTree(process, 'SIGTERM');
			this.processes.delete(id);
			return true;
		}
		return false;
	}

	killAll(signal: NodeJS.Signals = 'SIGTERM') {
		for (const process of this.processes.values()) {
			killProcessTree(process, signal);
		}
		this.processes.clear();
	}

	getProcess(id: string) {
		return this.processes.get(id);
	}
}

// Create a single instance to be used across the application
export const processManager = new ProcessManager();
