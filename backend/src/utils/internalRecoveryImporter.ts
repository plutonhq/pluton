import type { RecoveryTestStore } from '../stores/RecoveryTestStore';
import type { RecoveryImportLease } from '../db/schema/recoveryTests';
import {
	WorkerRecoveryDatabaseImporter,
	MysqlRecoveryWorkerClient,
} from './mysqlRecoveryWorkerClient';
import { RecoveryDatabaseImporter } from './recoveryDatabaseImport';
import { InternalRecoveryTargets } from './internalRecoveryTargets';
import { RecoveryTestError } from './recoveryValidation';
import { runRecoveryProcess } from './recoveryProcess';
import { detectRecoveryClient } from './recoveryDatabaseClients';
import { withRecoveryResourceGuard } from './recoveryResourceGuard';

/** Custom/native and Oracle worker paths stay unchanged. Only irt_ activations use the pinned internal CA. */
export class InternalRecoveryImporter extends WorkerRecoveryDatabaseImporter {
	constructor(
		private readonly internalStore: RecoveryTestStore,
		private readonly internal: InternalRecoveryTargets,
		private readonly nativeRun = runRecoveryProcess
	) {
		super(internalStore);
	}
	private async native(id: string, cleanup = false) {
		const session = await this.internalStore.internalSession(id);
		if (!session || session.releasedAt)
			throw new RecoveryTestError('database-target-preflight', 'internal-target-unsafe');
		return new RecoveryDatabaseImporter(
			this.internalStore,
			this.nativeRun,
			detectRecoveryClient,
			() => this.internal.trust(session, cleanup)
		);
	}
	private async mysql(id: string, cleanup = false) {
		const session = await this.internalStore.internalSession(id);
		if (
			!session ||
			session.releasedAt ||
			session.engine !== 'mysql' ||
			!this.internal.automatic?.record(session.testId)
		)
			throw new RecoveryTestError('database-target-preflight', 'internal-target-unsafe');
		await this.internal.trust(session, cleanup);
		return new MysqlRecoveryWorkerClient(this.internalStore, undefined, async testId => {
			if (testId !== session.testId)
				throw new RecoveryTestError('database-target-preflight', 'internal-target-unsafe');
			const binding = JSON.parse(this.internal.automatic!.record(testId)!.binding);
			return { id: testId, snapshotId: binding.snapshotId };
		});
	}
	override async importDatabase(input: Parameters<RecoveryDatabaseImporter['importDatabase']>[0]) {
		if (!input.targetId.startsWith('irt_')) return super.importDatabase(input);
		const importer =
			input.target.engine === 'mysql'
				? await this.mysql(input.targetId)
				: await this.native(input.targetId);
		try {
			return await withRecoveryResourceGuard(
				input.signal,
				() => this.internal.preflight(input.target.engine, [input.entry], input.directory),
				signal => importer.importDatabase({ ...input, signal })
			);
		} catch (error) {
			if (error instanceof RecoveryTestError) {
				input.entry.importValidation = 'failed';
				input.entry.failureCode = error.code;
			}
			throw error;
		}
	}
	override async cleanup(lease: RecoveryImportLease, directory: string) {
		if (
			lease.targetId.startsWith('irt_') &&
			(await this.internalStore.internalSession(lease.targetId))?.engine === 'mysql'
		)
			return (await this.mysql(lease.targetId, true)).cleanup(lease);
		return lease.targetId.startsWith('irt_')
			? (await this.native(lease.targetId, true)).cleanup(
					lease,
					directory,
					(await this.internalStore.internalSession(lease.targetId))?.engine === 'postgresql'
				)
			: super.cleanup(lease, directory);
	}
	override async verifyEmptyTarget(
		target: Parameters<RecoveryDatabaseImporter['verifyEmptyTarget']>[0],
		directory: string
	) {
		if (target.engine === 'mysql') {
			const session = await this.internalStore.internalSession(target.id);
			if (!session) throw new RecoveryTestError('database-cleanup', 'internal-target-unsafe');
			return (await this.mysql(target.id, true)).verifyEmptyTarget(target, session.testId);
		}
		return (await this.native(target.id, true)).verifyEmptyTarget(target, directory);
	}
}
