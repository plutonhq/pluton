import crypto from 'crypto';
import path from 'path';
import type { BackupStore } from '../stores/BackupStore';
import type { PlanStore } from '../stores/PlanStore';
import type { RecoveryTestStore } from '../stores/RecoveryTestStore';
import type { RecoveryTest } from '../db/schema/recoveryTests';
import type {
	RecoveryCode,
	RecoveryResult,
	RecoveryStage,
	RecoveryWarning,
} from '../types/recoveryTests';
import type { RemoteRepositoryRecoveryService } from './RemoteRepositoryRecoveryService';
import { RemoteBackupService } from './RemoteBackupService';
import { ManagedRepositoryAccessError } from '../utils/restic/ManagedSftpRepositorySession';
import { RecoveryDatabaseImporter } from '../utils/recoveryDatabaseImport';
import { InternalRecoveryImporter } from '../utils/internalRecoveryImporter';
import { InternalRecoveryTargets, mysqlWorkerReadiness } from '../utils/internalRecoveryTargets';
import {
	checkRecoveryCancellation,
	recoveryArtifacts,
	RecoveryTestError,
	validateRecoveryArtifact,
} from '../utils/recoveryValidation';
import { RecoveryWorkspace } from '../utils/recoveryWorkspace';
import { appPaths } from '../utils/AppPaths';
import { AppError, NotFoundError } from '../utils/AppError';
import { planLogger } from '../utils/logger';
import {
	recoveryMetadataToken,
	manualRecoveryPolicy,
	type RecoveryManualSelection,
} from '../utils/recoveryPreparation';
import { DatabaseRestoreError } from '../utils/persistentRestorePolicy';

/** Durable jobs and a separate result. No backup writes or source-agent calls. */
export class RecoveryTestService {
	private tickCompletion?: Promise<void>;
	private stopping = false;
	private running?: { id: string; controller: AbortController; done: Promise<void> };
	private readonly workspace: RecoveryWorkspace;
	private readonly importer: RecoveryDatabaseImporter;
	private readonly preparing = new Set<string>();
	constructor(
		private readonly store: RecoveryTestStore,
		private readonly plans: PlanStore,
		private readonly backups: BackupStore,
		private readonly recovery: Pick<
			RemoteRepositoryRecoveryService,
			'testBinding' | 'testRestore' | 'testMetadata'
		>,
		root = path.join(appPaths.getDataDir(), 'recovery-tests'),
		importer?: RecoveryDatabaseImporter,
		private readonly internal = new InternalRecoveryTargets()
	) {
		this.workspace = new RecoveryWorkspace(root);
		this.importer = importer || new InternalRecoveryImporter(store, internal);
	}
	private async ownedPlan(planId: string) {
		const plan = await this.plans.getById(planId, false);
		if (!plan) throw new NotFoundError('Plan not found.');
		if (!RemoteBackupService.isRemoteFilesystemPlan(plan))
			throw new AppError(400, 'Recovery testing supports remote managed filesystem plans only.');
		return plan;
	}
	async configuration(planId: string) {
		await this.ownedPlan(planId);
		const pending = await this.store.pendingInternalSessions();
		const internalTargets = await this.internal.readiness(pending);
		for (const view of internalTargets) {
			const session = pending.find(value => value.engine === view.engine);
			if (session && (await this.store.get(session.testId))?.status !== 'running')
				view.status = 'cleanup_required';
		}
		return {
			policy: await this.store.policy(planId),
			targets: await this.store.targets(planId),
			internalTargets,
			mysqlWorker: await mysqlWorkerReadiness(),
		};
	}
	/** On-demand only; no heavyweight filesystem scan, source contact or heartbeat work. */
	async preparation(planId: string, backupId: string, snapshotId: string) {
		const plan = await this.ownedPlan(planId);
		if (this.preparing.size >= 2 || this.preparing.has(planId))
			throw new AppError(429, 'Snapshot preparation is already in progress. Try again shortly.');
		this.preparing.add(planId);
		try {
			const metadata = await this.recovery.testMetadata(backupId, planId, snapshotId);
			const configuration = await this.configuration(planId);
			const internalTargets = await Promise.all(
				configuration.internalTargets.map(async view => ({
					...view,
					...(view.status === 'ready' &&
					metadata.databases.some(entry => entry.engine === view.engine)
						? {
								admission: await this.internal.admission(
									view.engine,
									metadata.databases.filter(entry => entry.engine === view.engine),
									path.dirname(this.workspace.root)
								),
							}
						: {}),
				}))
			);
			return {
				...metadata,
				planTitle: plan.title,
				metadataToken: recoveryMetadataToken(metadata),
				metadataVerification: 'receipt-and-exact-snapshot-path-size' as const,
				artifactHashVerification: 'mandatory-before-import' as const,
				versionCompatibility: 'not-recorded-in-receipt' as const,
				policy: configuration.policy,
				customTargets: configuration.targets.map(target => ({
					engine: target.engine,
					status: target.enabled && target.passwordConfigured ? 'configured' : 'not_configured',
				})),
				internalTargets,
				mysqlWorker: configuration.mysqlWorker,
				resources: await this.internal.resourceView(path.dirname(this.workspace.root)),
				workloads: await this.store.activity(),
				lifecycle: this.internal.automatic ? ('automatic' as const) : ('operator-managed' as const),
				persistentRestore: {
					status: 'unavailable' as const,
					reason: 'separate-retained-workflow-at-api-database-restores' as const,
				},
			};
		} finally {
			this.preparing.delete(planId);
		}
	}
	async enqueueManual(planId: string, input: RecoveryManualSelection) {
		const preview = await this.preparation(planId, input.backupId, input.snapshotId);
		if (preview.metadataToken !== input.metadataToken)
			throw new AppError(409, 'Snapshot metadata changed. Review the confirmation again.');
		const policy = manualRecoveryPolicy(preview.policy, input, preview.databases);
		policy.snapshotMetadataToken = preview.metadataToken;
		if (policy.databaseImport === 'required' && Object.values(preview.workloads).some(Boolean))
			throw new RecoveryTestError('database-target-preflight', 'recovery-workload-busy');
		if (policy.databaseImport === 'required')
			for (const entry of preview.databases) {
				const internal = entry.engine && policy.targetModes?.[entry.engine] === 'internal';
				if (internal) {
					if (entry.engine === 'mysql' && preview.mysqlWorker !== 'ready')
						throw new RecoveryTestError('database-target-preflight', 'mysql-worker-unavailable');
					const target = preview.internalTargets.find(view => view.engine === entry.engine);
					if (target?.status !== 'ready')
						throw new RecoveryTestError(
							'database-target-preflight',
							'internal-target-not-provisioned'
						);
					if (target.admission?.status !== 'admitted')
						throw new RecoveryTestError(
							'database-target-preflight',
							'internal-resources-insufficient'
						);
				} else {
					if (
						!preview.customTargets.some(
							target => target.engine === entry.engine && target.status === 'configured'
						)
					)
						throw new RecoveryTestError(
							'database-target-preflight',
							'recovery-target-not-configured'
						);
					if (entry.engine === 'mysql' && preview.mysqlWorker !== 'ready')
						throw new RecoveryTestError('database-target-preflight', 'mysql-worker-unavailable');
				}
			}
		return this.store.enqueue({
			id: crypto.randomBytes(12).toString('hex'),
			planId,
			backupId: preview.backupId,
			repositoryId: preview.repositoryId,
			snapshotId: preview.snapshotId,
			status: 'queued',
			trigger: 'manual',
			policy,
			automationKey: null,
		});
	}
	async databaseRestoreUnavailable(planId: string) {
		await this.ownedPlan(planId);
		// Deprecated disposable route is not an alias for the separately authorized retained lifecycle.
		throw new AppError(
			409,
			'Persistent Database Restore is not available through the disposable Recovery Testing route. Use the separate Restore Database workflow and /api/database-restores.'
		);
	}
	async savePolicy(planId: string, input: unknown) {
		await this.ownedPlan(planId);
		return this.store.savePolicy(planId, input);
	}
	async saveTarget(planId: string, input: unknown) {
		await this.ownedPlan(planId);
		await this.store.saveTarget(planId, input);
		return this.configuration(planId);
	}
	async list(planId: string, backupIds?: string[]) {
		await this.ownedPlan(planId);
		return this.store.list(planId, backupIds);
	}
	async get(planId: string, id: string) {
		await this.ownedPlan(planId);
		const row = await this.store.get(id);
		if (!row || row.planId !== planId) throw new NotFoundError('Recovery test not found.');
		return row;
	}
	async enqueue(planId: string, backupId: string, trigger: 'manual' | 'after_backup' = 'manual') {
		await this.ownedPlan(planId);
		const policy = await this.store.policy(planId);
		if (trigger === 'after_backup' && !policy.enabled) return null;
		let binding;
		try {
			binding = await this.recovery.testBinding(backupId, planId);
		} catch {
			throw new RecoveryTestError('snapshot-validation', 'snapshot-binding-mismatch');
		}
		return this.store.enqueue({
			id: crypto.randomBytes(12).toString('hex'),
			...binding,
			status: 'queued',
			trigger,
			policy,
			automationKey:
				trigger === 'after_backup' ? `after-backup:${backupId}:${binding.snapshotId}` : null,
		});
	}
	/** Non-blocking task, dispatched by the existing JobProcessor. Global concurrency = 1. */
	tick(): Promise<void> {
		if (this.running || this.stopping) return Promise.resolve();
		return (this.tickCompletion ||= this.dispatch().finally(() => {
			this.tickCompletion = undefined;
		}));
	}
	private async dispatch(): Promise<void> {
		if (this.internal.automatic) {
			const activity = await this.store.activity();
			if (!activity.backup && !activity.restore) {
				const retry = await this.internal.automatic.cleanupRetryIds();
				if (retry.size) await this.recoverInterrupted(retry);
			}
		}
		await this.reconcileInfrastructure();
		for (const backupId of await this.store.automaticCandidates()) {
			const backup = await this.backups.getById(backupId);
			if (backup?.planId) {
				try {
					await this.enqueue(backup.planId, backupId, 'after_backup');
				} catch {
					this.log(
						backup.planId,
						backupId,
						'automatic-enqueue-failed',
						'job',
						'snapshot-binding-mismatch'
					);
				}
			}
		}
		const row = await this.store.claim();
		if (!row) return;
		const controller = new AbortController();
		if (this.stopping || (await this.store.get(row.id))?.cancelRequested) controller.abort();
		// Install the active controller before execution starts, including a
		// cancellation that races a queued -> running transactional claim.
		const done = Promise.resolve().then(() => this.execute(row, controller.signal));
		this.running = { id: row.id, controller, done };
		void done
			.catch(() =>
				this.log(row.planId, row.backupId, 'result-persistence-failed', 'job', 'unexpected', row.id)
			)
			.finally(() => {
				this.running = undefined;
			});
	}
	/** Useful for orderly shutdown/tests; HTTP disconnect never cancels a durable job. */
	async idle() {
		await this.running?.done;
	}
	async cancel(planId: string, id: string) {
		const row = await this.get(planId, id);
		if (!['queued', 'running'].includes(row.status)) return row;
		await this.store.requestCancellation(id);
		if (this.running?.id === id) {
			this.running.controller.abort();
			await this.running.done;
		}
		return this.get(planId, id);
	}
	async shutdown() {
		this.stopping = true;
		await this.tickCompletion;
		if (this.running) {
			this.running.controller.abort();
			await this.running.done;
		}
	}
	private log(
		planId: string,
		backupId: string,
		event: string,
		stage: RecoveryStage,
		code?: RecoveryCode,
		recoveryTestId?: string
	) {
		planLogger('restore', planId, backupId).warn(
			{ event: `recovery_test_${event}`, recoveryTestId, stage, code },
			'Recovery test checkpoint.'
		);
	}
	private async execute(row: RecoveryTest, signal: AbortSignal) {
		let stage: RecoveryStage = 'snapshot-validation';
		let failure: RecoveryTestError | undefined;
		const warnings: RecoveryWarning[] = [];
		const result: RecoveryResult = {
			databases: [],
			cleanup: { workspace: false, databases: false },
		};
		const setStage = (value: RecoveryStage) => {
			stage = value;
			// Stage display is advisory, not an ownership/cleanup checkpoint. Its
			// rejected promise must not terminate the server or leak provider output.
			// Authoritative job/lease/result writes below remain awaited and fail closed.
			void this.store.update(row.id, { stage: value }).catch(() => {
				planLogger('restore', row.planId, row.backupId).warn(
					{
						event: 'recovery_test_stage_persistence_failed',
						recoveryTestId: row.id,
						stage: value,
						code: 'stage-persistence-failed',
					},
					'Recovery stage display could not be persisted.'
				);
			});
			this.log(row.planId, row.backupId, 'stage', value, undefined, row.id);
		};
		let directory: string | undefined;
		let internalTarget: Awaited<ReturnType<RecoveryTestStore['beginInternalSession']>> | undefined;
		try {
			checkRecoveryCancellation(signal);
			const backup = await this.backups.getById(row.backupId);
			if (
				!backup ||
				backup.planId !== row.planId ||
				backup.completionStats?.snapshot_id !== row.snapshotId
			)
				throw new RecoveryTestError('snapshot-validation', 'snapshot-binding-mismatch');
			const assertReceipt = (lifecycle: unknown) => {
				if (
					row.policy.snapshotMetadataToken &&
					recoveryMetadataToken({
						planId: row.planId,
						backupId: row.backupId,
						repositoryId: row.repositoryId,
						snapshotId: row.snapshotId,
						databases: recoveryArtifacts(lifecycle),
					}) !== row.policy.snapshotMetadataToken
				)
					throw new RecoveryTestError('snapshot-validation', 'snapshot-binding-mismatch');
			};
			assertReceipt(backup.completionStats?.lifecycle);
			if (
				this.internal.automatic &&
				row.policy.databaseImport === 'required' &&
				recoveryArtifacts(backup.completionStats?.lifecycle).some(
					entry => entry.engine && row.policy.targetModes?.[entry.engine] === 'internal'
				)
			) {
				try {
					this.internal.automatic.assertAvailable(row.id);
				} catch {
					throw new RecoveryTestError('database-target-preflight', 'recovery-workload-busy');
				}
			}
			if ((await this.store.get(row.id))?.cancelRequested)
				throw new RecoveryTestError('job', 'cancelled');
			directory = await this.workspace.create(row.id);
			const files = path.join(directory, 'files');
			const { databaseArtifactPaths, ...filesystem } = await this.recovery.testRestore(
				row,
				files,
				signal,
				setStage,
				async () => {
					await this.workspace.assert(row.id);
				},
				Object.values(row.policy.targetModes || {}).includes('internal')
					? 4 * 1024 ** 3
					: 1024 ** 4,
				() => {
					warnings.push({ stage: 'workspace-cleanup', code: 'workspace-cleanup-failed' });
				}
			);
			result.filesystem = filesystem;
			setStage('database-artifact-validation');
			result.databases = recoveryArtifacts(backup.completionStats?.lifecycle);
			if (
				databaseArtifactPaths.some(
					artifact => !result.databases.some(entry => entry.path === artifact)
				)
			)
				throw new RecoveryTestError('database-artifact-validation', 'database-metadata-incomplete');
			const artifacts = new Map<string, string>();
			for (const entry of result.databases)
				artifacts.set(entry.path, await validateRecoveryArtifact(entry, files, signal));
			assertReceipt((await this.backups.getById(row.backupId))?.completionStats?.lifecycle);
			const internalEngines = [
				...new Set(
					result.databases
						.filter(
							entry =>
								row.policy.databaseImport === 'required' &&
								entry.engine &&
								row.policy.targetModes?.[entry.engine] === 'internal'
						)
						.map(entry => entry.engine!)
				),
			];
			if (internalEngines.length > 1)
				throw new RecoveryTestError('database-target-preflight', 'internal-target-unsafe');
			if (internalEngines.length) {
				setStage('database-target-preflight');
				const engine = internalEngines[0] as 'mariadb' | 'postgresql' | 'mysql';
				result.internalEngine = engine;
				const entries = result.databases.filter(entry => entry.engine === engine);
				// Admission precedes host provisioning and is repeated before native import.
				if (this.internal.automatic) {
					const activity = await this.store.activity();
					if (activity.backup || activity.restore)
						throw new RecoveryTestError('database-target-preflight', 'recovery-workload-busy');
					await this.internal.preflight(engine, entries, directory, 'provision');
				}
				const activation = await this.internal.prepare(
					engine,
					entries,
					this.internal.automatic
						? {
								directory,
								testId: row.id,
								snapshotId: row.snapshotId,
								createdAt: row.createdAt.getTime(),
								signal,
								stage: value => setStage(value as RecoveryStage),
							}
						: undefined
				);
				checkRecoveryCancellation(signal);
				internalTarget = await this.store.beginInternalSession({ testId: row.id, ...activation });
				result.internalEngine = engine;
				result.cleanup.infrastructure = false;
				await this.store.update(row.id, { result });
				// Bind the manually activated infrastructure durably before admission, but never import before admission.
				await this.internal.preflight(engine, entries, directory);
			}
			for (const entry of result.databases) {
				checkRecoveryCancellation(signal);
				if (row.policy.databaseImport === 'disabled') {
					entry.importValidation = 'disabled';
					warnings.push({ stage: 'database-import', code: 'import-disabled' });
					continue;
				}
				setStage('database-target-preflight');
				const activity = await this.store.activity();
				if (activity.backup || activity.restore)
					throw new RecoveryTestError('database-target-preflight', 'recovery-workload-busy');
				if (!entry.engine || !entry.database) {
					entry.importValidation = 'not_configured';
					entry.failureCode = 'database-metadata-incomplete';
					throw new RecoveryTestError(stage, 'database-metadata-incomplete');
				}
				let saved;
				try {
					saved =
						internalTarget?.engine === entry.engine
							? internalTarget
							: await this.store.target(row.planId, entry.engine);
				} catch {
					entry.importValidation = 'not_configured';
					entry.failureCode = 'recovery-target-not-configured';
					throw new RecoveryTestError(stage, 'recovery-target-not-configured');
				}
				if (!saved) {
					entry.importValidation = 'not_configured';
					entry.failureCode = 'recovery-target-not-configured';
					throw new RecoveryTestError(stage, 'recovery-target-not-configured');
				}
				const { id: targetId, ...target } = saved;
				{
					const plan = await this.ownedPlan(row.planId);
					const lifecycle = plan.settings?.remoteLifecycle;
					const sources = lifecycle?.databases || (lifecycle?.database ? [lifecycle.database] : []);
					if (
						sources.some(
							source =>
								source.host.toLowerCase() === target.host.toLowerCase() &&
								source.port === target.port
						)
					)
						throw new RecoveryTestError(stage, 'recovery-target-unsafe');
				}
				await this.importer.importDatabase({
					testId: row.id,
					targetId,
					target,
					entry,
					file: artifacts.get(entry.path)!,
					directory,
					signal,
					stage: setStage,
					allowedDatabases: result.databases
						.filter(value => value.engine === entry.engine)
						.map(value => value.database!)
						.filter(Boolean),
				});
			}
		} catch (error) {
			failure = signal.aborted
				? new RecoveryTestError(stage, 'cancelled')
				: error instanceof DatabaseRestoreError
					? new RecoveryTestError(
							stage,
							error.code === 'target-memory-exhausted'
								? 'database-out-of-memory'
								: error.code.startsWith('resource-') || error.code === 'operator-budget-refused'
									? 'internal-resources-insufficient'
									: error.code === 'lifecycle-unavailable'
										? 'internal-operator-unavailable'
										: error.code === 'lifecycle-readiness-timeout'
											? 'internal-provisioning-timeout'
											: error.code === 'internal-lifecycle-busy'
												? 'recovery-workload-busy'
												: 'internal-target-unsafe'
						)
					: error instanceof RecoveryTestError
						? error
						: error instanceof ManagedRepositoryAccessError
							? new RecoveryTestError(
									stage,
									error.code === 'wrong-password'
										? 'repository-auth-failed'
										: error.code === 'timeout'
											? 'restore-timeout'
											: 'repository-access-failed'
								)
							: new RecoveryTestError(
									stage,
									stage === 'snapshot-validation' ? 'snapshot-binding-mismatch' : 'unexpected'
								);
			this.log(row.planId, row.backupId, 'failed', failure.stage, failure.code, row.id);
		} finally {
			setStage('database-cleanup');
			let databasesClean = true;
			try {
				for (const lease of await this.store.leases(row.id)) {
					if (!directory) {
						databasesClean = false;
						warnings.push({ stage: 'database-cleanup', code: 'database-cleanup-failed' });
						continue;
					}
					try {
						await this.importer.cleanup(lease, directory);
					} catch {
						databasesClean = false;
						warnings.push({ stage: 'database-cleanup', code: 'database-cleanup-failed' });
					}
				}
			} catch {
				databasesClean = false;
				warnings.push({ stage: 'database-cleanup', code: 'database-cleanup-failed' });
			}
			if (internalTarget && databasesClean && directory)
				try {
					await this.importer.verifyEmptyTarget(internalTarget, directory);
				} catch {
					databasesClean = false;
					warnings.push({ stage: 'database-cleanup', code: 'database-cleanup-failed' });
				}
			result.cleanup.databases = databasesClean;
			setStage('workspace-cleanup');
			try {
				await this.workspace.remove(row.id);
				result.cleanup.workspace = true;
			} catch {
				warnings.push({ stage: 'workspace-cleanup', code: 'workspace-cleanup-failed' });
				planLogger('restore', row.planId, row.backupId).warn(
					{
						event: 'recovery_test_workspace_cleanup_failed',
						recoveryTestId: row.id,
						workspace: this.workspace.path(row.id),
					},
					'Inspect this exact inactive recovery workspace.'
				);
			}
		}
		if (internalTarget) {
			setStage('infrastructure-cleanup');
			const clean =
				result.cleanup.databases &&
				result.cleanup.workspace &&
				(await this.store.leases(row.id)).length === 0;
			if (clean) await this.store.markInternalCleanupReady(internalTarget.id);
			const session = await this.store.internalSession(internalTarget.id);
			if (session)
				try {
					await this.internal.requestCleanup(session, row.snapshotId);
				} catch {
					/* Required pending receipt below. */
				}
			warnings.push({ stage: 'infrastructure-cleanup', code: 'internal-cleanup-required' });
			failure ||= new RecoveryTestError('infrastructure-cleanup', 'internal-cleanup-required');
		} else if (this.internal.automatic?.record(row.id)) {
			// Creation may have finished after cancellation / before the session was bound.
			result.cleanup.infrastructure = false;
			try {
				await this.internal.automatic.action(
					row.id,
					'delete',
					result.cleanup.workspace &&
						result.cleanup.databases &&
						!(await this.store.leases(row.id)).length
				);
			} catch {
				/* Intent remains durable; no absence inference. */
			}
			warnings.push({ stage: 'infrastructure-cleanup', code: 'internal-cleanup-required' });
			failure ||= new RecoveryTestError('infrastructure-cleanup', 'internal-cleanup-required');
		}
		const cancelled = signal.aborted || (await this.store.get(row.id))?.cancelRequested;
		await this.store.update(row.id, {
			status: cancelled
				? 'cancelled'
				: failure
					? 'failed'
					: warnings.length
						? 'passed_with_warning'
						: 'passed',
			completedAt: new Date(),
			result,
			warnings,
			failureStage: cancelled ? 'job' : failure?.stage || null,
			failureCode: cancelled ? 'cancelled' : failure?.code || null,
		});
	}
	/** Running work is not resumed after a crash. Cleanup requires the durable DB owner marker. */
	async recoverInterrupted(onlyIds?: Set<string>) {
		const interrupted = onlyIds ? [] : await this.store.interrupted();
		const leases = await this.store.leases();
		const ids = new Set([
			...interrupted.map(row => row.id),
			...leases.map(lease => lease.testId),
			...(await this.store.cleanupCandidates()).map(row => row.id),
			...(await this.store.pendingInternalSessions()).map(row => row.testId),
		]);
		for (const id of ids) {
			if (onlyIds && !onlyIds.has(id)) continue;
			const row = await this.store.get(id);
			if (!row || ['queued', 'running'].includes(row.status)) continue;
			let directory: string | undefined;
			const warnings = row.warnings.filter(
				warning => !['database-cleanup', 'workspace-cleanup'].includes(warning.stage)
			);
			let databasesClean = true,
				workspaceClean = true;
			try {
				try {
					directory = await this.workspace.assert(id);
				} catch {
					directory = await this.workspace.create(id);
				}
				for (const lease of leases.filter(value => value.testId === id)) {
					try {
						await this.importer.cleanup(lease, directory);
					} catch {
						databasesClean = false;
						warnings.push({ stage: 'database-cleanup', code: 'database-cleanup-failed' });
					}
				}
				const internalSession = (await this.store.pendingInternalSessions()).find(
					value => value.testId === id
				);
				if (internalSession && databasesClean && !internalSession.cleanupReady)
					try {
						const target = await this.store.leaseTarget(internalSession.id);
						if (!target) throw new Error();
						await this.importer.verifyEmptyTarget({ ...target, id: internalSession.id }, directory);
					} catch {
						databasesClean = false;
						warnings.push({ stage: 'database-cleanup', code: 'database-cleanup-failed' });
					}
			} catch {
				databasesClean = !leases.some(lease => lease.testId === id);
				workspaceClean = false;
				warnings.push({ stage: 'workspace-cleanup', code: 'unsafe-workspace' });
			}
			try {
				await this.workspace.remove(id);
			} catch {
				workspaceClean = false;
				warnings.push({ stage: 'workspace-cleanup', code: 'workspace-cleanup-failed' });
			}
			await this.store.update(id, {
				warnings,
				...(row.result || this.internal.automatic?.record(id)
					? {
							result: {
								...(row.result || { databases: [] }),
								cleanup: {
									...row.result?.cleanup,
									databases: databasesClean,
									workspace: workspaceClean,
									...(this.internal.automatic?.record(id) ? { infrastructure: false } : {}),
								},
							},
						}
					: {}),
			});
			const session = (await this.store.pendingInternalSessions()).find(
				value => value.testId === id
			);
			if (session) {
				if (databasesClean && workspaceClean && !(await this.store.leases(id)).length)
					await this.store.markInternalCleanupReady(session.id);
				const latest = await this.store.internalSession(session.id);
				if (latest)
					try {
						await this.internal.requestCleanup(latest, row.snapshotId);
					} catch {
						/* Retain pending cleanup. */
					}
			}
		}
		await this.reconcileInfrastructure();
	}
	/** A root-authenticated removal receipt is required; SQL success alone cannot mean Passed. */
	private async reconcileInfrastructure() {
		await this.internal.automatic?.reconcileTesting();
		for (const session of await this.store.pendingInternalSessions()) {
			const row = await this.store.get(session.testId);
			if (
				!row ||
				['queued', 'running'].includes(row.status) ||
				!session.cleanupReady ||
				(await this.store.leases(row.id)).length ||
				!(await (this.internal.automaticallyRemoved?.(session, row.snapshotId) ??
					this.internal.removed(session, row.snapshotId)))
			)
				continue;
			const warnings = row.warnings.filter(warning => warning.code !== 'internal-cleanup-required');
			const complete =
				!!row.result?.filesystem &&
				row.result.databases.every(
					entry => entry.artifactValidation === 'passed' && entry.importValidation === 'passed'
				) &&
				row.result.cleanup.workspace &&
				row.result.cleanup.databases;
			const pendingSuccess =
				!row.cancelRequested && row.failureCode === 'internal-cleanup-required' && complete;
			await this.store.completeInternalCleanup(session.id, {
				completedAt: new Date(),
				warnings,
				...(row.result
					? { result: { ...row.result, cleanup: { ...row.result.cleanup, infrastructure: true } } }
					: {}),
				...(pendingSuccess
					? {
							status: warnings.length ? 'passed_with_warning' : 'passed',
							failureCode: null,
							failureStage: null,
						}
					: {}),
			});
		}
	}
}
