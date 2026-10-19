import type { RecoveryTestService } from '../../services/RecoveryTestService';
import { Task } from './AbstractTask';
export class RecoveryTestTask extends Task {
	name = 'RecoveryTest';
	constructor(private readonly recovery: RecoveryTestService) {
		super();
	}
	async run() {
		await this.recovery.tick();
	}
}
