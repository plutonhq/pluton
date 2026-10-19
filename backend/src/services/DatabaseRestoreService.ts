import crypto from 'crypto';
import path from 'path';
import {
	RESTORE_PURPOSE,
	type DatabaseRestore,
	type PersistentTargetApproval,
} from '../types/databaseRestores';
import type { DatabaseRestoreStore } from '../stores/DatabaseRestoreStore';
import type { RemoteRepositoryRecoveryService } from './RemoteRepositoryRecoveryService';
import type { PlanStore } from '../stores/PlanStore';
import { PersistentRestoreTargets } from '../utils/persistentRestoreTargets';
import { PersistentDatabaseImporter } from '../utils/persistentDatabaseImporter';
import { MysqlPersistentDatabaseImporter } from '../utils/mysqlPersistentDatabaseImporter';
import {
	restoreInput,
	restoreRequest,
	restoreSelection,
	DatabaseRestoreError,
	restoreId,
} from '../utils/persistentRestorePolicy';
import { RecoveryWorkspace } from '../utils/recoveryWorkspace';
import { RecoveryTestError, validateRecoveryArtifact } from '../utils/recoveryValidation';
import { recoveryMetadataToken } from '../utils/recoveryPreparation';
import { appPaths } from '../utils/AppPaths';
import { AppError } from '../utils/AppError';
import { planLogger } from '../utils/logger';
import { internalResourceReason } from '../utils/internalRecoveryTargets';
import { MysqlWorkerConnection } from '../utils/mysqlRecoveryWorkerClient';
import { withRecoveryResourceGuard } from '../utils/recoveryResourceGuard';

type Recovery = Pick<RemoteRepositoryRecoveryService, 'testMetadata' | 'databaseRestoreArtifact'>;
type Importer = Pick<PersistentDatabaseImporter, 'restore' | 'inspect' | 'removeOwned'>;
/** One-time retained operations: never change saved plans, test policies or backup results. */
export class DatabaseRestoreService {
	private readonly workspace: RecoveryWorkspace;
	private running?: { id: string; controller: AbortController; done: Promise<void> };
	private ticking?: Promise<void>;
	private stopping = false;
	private readonly preparing = new Set<string>();
	constructor(
		private readonly store: DatabaseRestoreStore,
		private readonly plans: Pick<PlanStore, 'getById'>,
		private readonly recovery: Recovery,
		private readonly targets = new PersistentRestoreTargets(),
		root = path.join(appPaths.getDataDir(), 'persistent-database-restores'),
		private readonly importer = (approval: PersistentTargetApproval, ca: string): Importer =>
			approval.engine === 'mysql'
				? new MysqlPersistentDatabaseImporter(store, approval)
				: new PersistentDatabaseImporter(store, approval, ca)
	) {
		this.workspace = new RecoveryWorkspace(root);
	}
	private async plan(id: string) {
		const plan = await this.plans.getById(id, false);
		if (
			!plan ||
			plan.sourceType !== 'device' ||
			plan.sourceId === 'main' ||
			plan.method !== 'backup'
		)
			throw new AppError(404, 'Remote managed plan not found.');
		return plan;
	}
	private row(id: string, owner: string) {
		if (!restoreId.safeParse(id).success) throw new AppError(404, 'Database restore not found.');
		const row = this.store.get(id);
		if (!row || row.owner !== owner) throw new AppError(404, 'Database restore not found.');
		return row;
	}
	private view(row: DatabaseRestore) {
		const lifecycle = row.mode === 'internal' ? this.targets.automatic?.record(row.id) : undefined;
		// Positive allowlist: no credentials, owner tokens, paths, SQL or approval internals.
		return {
			id: row.id,
			purpose: row.purpose,
			planId: row.planId,
			backupId: row.backupId,
			repositoryId: row.repositoryId,
			snapshotId: row.snapshotId,
			databaseId: row.databaseId,
			engine: row.artifact.engine,
			logicalDatabase: row.artifact.database,
			sqlBytes: row.artifact.bytes,
			sha256: row.artifact.sha256,
			mode: row.mode,
			targetId: row.targetId,
			database: row.database,
			status: row.status,
			stage: row.stage,
			cleanup: row.cleanup,
			createdAt: row.createdAt,
			startedAt: row.startedAt,
			completedAt: row.completedAt ?? null,
			failureStage: row.failureStage ?? null,
			failureCode: row.failureCode ?? null,
			expiresAt: row.expiresAt,
			lastValidatedAt: row.lastValidatedAt,
			errorCode: row.errorCode,
			inspection: row.expiresAt > Date.now() && row.status === 'active' ? row.inspection : null,
			expired: row.expiresAt <= Date.now(),
			cancelRequested: row.cancelRequested,
			operatorAction:
				row.mode === 'internal' &&
				(lifecycle
					? lifecycle.state === 'cleanup-required' || row.errorCode === 'lifecycle-unavailable'
					: ['provisioning_required', 'cleanup_required', 'expired', 'stopped'].includes(
							row.status
						)),
			lifecycle:
				row.mode === 'internal' && this.targets.automatic?.record(row.id)
					? {
							mode: 'automatic' as const,
							state: this.targets.automatic.record(row.id)!.state,
							code: this.targets.automatic.record(row.id)!.code,
							quotaBytes: 2147483648,
						}
					: undefined,
		};
	}
	async preview(input: unknown) {
		const selection = restoreInput(restoreSelection, input);
		const plan = await this.plan(selection.planId);
		if (this.preparing.size >= 2 || this.preparing.has(selection.planId))
			throw new AppError(429, 'Restore preparation is busy.');
		this.preparing.add(selection.planId);
		try {
			const metadata = await this.recovery.testMetadata(
				selection.backupId,
				selection.planId,
				selection.snapshotId
			);
			const policy = await this.targets.policy();
			const lifecycle = this.targets.automatic
				? await this.targets.automatic.capability()
				: undefined;
			const mysqlInternal =
				lifecycle?.available &&
				(lifecycle.engines as readonly string[]).includes('mysql') &&
				(await new MysqlWorkerConnection().internalReady());
			return {
				...metadata,
				planTitle: plan.title,
				metadataToken: recoveryMetadataToken(metadata),
				targets: await this.targets.list(),
				resources: await this.targets.resourceView(path.dirname(this.workspace.root)),
				workloadBusy: this.store.busy(),
				engines: {
					mariadb: ['internal', 'custom'],
					postgresql: ['internal', 'custom'],
					mysql:
						process.env.PLUTON_MYSQL_WORKER === 'enabled'
							? [...(mysqlInternal ? ['internal'] : []), 'custom']
							: [],
				},
				internalPolicy: policy,
				lifecycle,
				retentionSeconds: [
					3600,
					21600,
					86400,
					...(policy.maxRetentionSeconds > 86400 ? [policy.maxRetentionSeconds] : []),
				],
				warnings: [
					'SQL integrity is verified after private staging, before import.',
					'Operator-managed Internal targets use separate bounded persistent storage.',
					'No source overwrite. Oracle MySQL requires the optional genuine worker; Internal additionally requires its root-bound automatic profile.',
				],
			};
		} finally {
			this.preparing.delete(selection.planId);
		}
	}
	async create(input: unknown, owner: string) {
		const request = restoreInput(restoreRequest, input);
		const preview = await this.preview({
			planId: request.planId,
			backupId: request.backupId,
			snapshotId: request.snapshotId,
		});
		if (preview.metadataToken !== request.metadataToken)
			throw new DatabaseRestoreError('snapshot-metadata-changed');
		const artifact = preview.databases.find(entry => entry.databaseId === request.databaseId);
		if (!artifact?.database || !artifact.engine)
			throw new DatabaseRestoreError('database-metadata-incomplete');
		if (
			artifact.engine === 'mysql' &&
			request.mode === 'internal' &&
			!preview.engines.mysql.includes('internal')
		)
			throw new DatabaseRestoreError('mysql-internal-unavailable');
		if (artifact.engine === 'mysql' && process.env.PLUTON_MYSQL_WORKER !== 'enabled')
			throw new DatabaseRestoreError('mysql-worker-not-configured');
		if (artifact.bytes > preview.internalPolicy.maxSqlBytes && request.mode === 'internal')
			throw new DatabaseRestoreError('resource-operator-sql-budget');
		const id = crypto.randomBytes(12).toString('hex'),
			now = Date.now();
		let row: DatabaseRestore = {
			id,
			owner,
			purpose: RESTORE_PURPOSE,
			planId: request.planId,
			backupId: request.backupId,
			repositoryId: preview.repositoryId,
			snapshotId: request.snapshotId,
			databaseId: request.databaseId,
			artifact,
			metadataToken: request.metadataToken,
			mode: request.mode,
			targetId: request.mode === 'internal' ? id : request.targetId!,
			targetFingerprint: null,
			encryptedApproval: null,
			ownerToken: crypto.randomBytes(24).toString('hex'),
			database: null,
			status: request.mode === 'internal' ? 'provisioning_required' : 'queued',
			stage:
				request.mode === 'internal' && this.targets.automatic
					? 'checking-resources'
					: 'operator-provisioning',
			cleanup: 'none',
			createdAt: now,
			startedAt: null,
			expiresAt: now + request.ttlSeconds * 1000,
			ttlSeconds: request.ttlSeconds,
			lastValidatedAt: null,
			inspection: null,
			errorCode: null,
			cancelRequested: false,
		};
		if (row.mode === 'internal' && row.ttlSeconds > preview.internalPolicy.maxRetentionSeconds)
			throw new DatabaseRestoreError('retention-not-approved');
		if (row.mode === 'internal') {
			if (this.store.busy()) throw new DatabaseRestoreError('database-workload-busy');
			// Fresh measurement immediately before durable reservation, not only the
			// earlier metadata preview. Root independently rechecks before creation.
			const measured = await this.targets.resourceView(path.dirname(this.workspace.root));
			if (row.artifact.engine === 'mysql' && !measured.sample?.operatorObservedAt)
				throw new DatabaseRestoreError('resource-capacity-unknown');
			const reason = measured.sample
				? internalResourceReason(
						measured.sample,
						artifact.bytes,
						artifact.engine === 'mysql'
							? Math.min(preview.internalPolicy.maxSqlBytes, 128 * 1024 ** 2)
							: preview.internalPolicy.maxSqlBytes,
						artifact.engine,
						'provision'
					)
				: 'capacity-unknown';
			if (reason) throw new DatabaseRestoreError(`resource-${reason}`);
		}
		let approval: PersistentTargetApproval | undefined;
		if (row.mode === 'custom') {
			approval = await this.targets.assertBinding(row);
			this.store.assertNotSource(approval);
			await this.targets.admission(approval, row, path.dirname(this.workspace.root));
		}
		if (row.mode === 'internal') this.targets.automatic?.assertAvailable();
		row = this.store.create(row);
		if (approval) row = this.store.bind(row.id, approval);
		if (row.mode === 'internal') {
			try {
				await this.targets.request(row, 'provision');
			} catch {
				row = this.store.update(id, {
					errorCode: this.targets.automatic
						? 'lifecycle-unavailable'
						: 'operator-request-directory-unavailable',
				});
			}
		}
		return this.view(row);
	}
	list(owner: string) {
		return this.store
			.list()
			.filter(row => row.owner === owner)
			.map(row => this.view(row));
	}
	get(id: string, owner: string) {
		return this.view(this.row(id, owner));
	}
	async inspect(id: string, owner: string) {
		const row = this.row(id, owner);
		if (row.expiresAt <= Date.now() || row.cancelRequested || row.status !== 'active')
			throw new DatabaseRestoreError('restore-access-not-active');
		if (this.running || this.ticking || this.store.busy())
			throw new DatabaseRestoreError('database-workload-busy');
		const controller = new AbortController();
		const operation = this.inspectOwned(row, controller.signal);
		this.running = {
			id,
			controller,
			done: operation.then(
				() => undefined,
				() => undefined
			),
		};
		return operation.finally(() => {
			this.running = undefined;
		});
	}
	private async inspectOwned(row: DatabaseRestore, signal: AbortSignal) {
		const id = row.id;
		const approval = await this.targets.assertBinding(row, this.store.approval(id));
		this.store.assertNotSource(approval);
		if ((await this.targets.state(approval)).state === 'stopped')
			throw new DatabaseRestoreError('operator-target-stopped');
		const directory = await this.workspace.create(id);
		try {
			const inspection = await this.importer(approval, await this.targets.ca(approval)).inspect(
				row,
				directory,
				signal
			);
			if (signal.aborted || this.store.get(id)?.cancelRequested || row.expiresAt <= Date.now())
				throw new DatabaseRestoreError('restore-access-not-active');
			return this.view(this.store.update(id, { inspection, lastValidatedAt: Date.now() }));
		} finally {
			await this.workspace.remove(id);
		}
	}
	async delete(id: string, owner: string, input: unknown) {
		const row = this.row(id, owner);
		if (
			!input ||
			typeof input !== 'object' ||
			Object.keys(input).length !== 1 ||
			(input as { confirmation?: string }).confirmation !== id
		)
			throw new AppError(400, 'Confirm the exact restore ID.');
		if (row.status === 'deleted') return this.view(row);
		this.store.requestDelete(id);
		if (this.running?.id === id) {
			this.running.controller.abort();
			await this.running.done;
		}
		await this.tick();
		return this.get(id, owner);
	}
	async operator(id: string, owner: string, action: 'provision' | 'stop' | 'resume') {
		const row = this.row(id, owner);
		if (
			row.mode !== 'internal' ||
			row.cancelRequested ||
			row.expiresAt <= Date.now() ||
			row.status === 'deleted' ||
			(action === 'provision' && row.status !== 'provisioning_required') ||
			(action === 'stop' && row.status !== 'active') ||
			(action === 'resume' &&
				row.status !== 'stopped' &&
				!(
					row.status === 'provisioning_required' &&
					this.targets.automatic?.record(row.id)?.state === 'stopped'
				))
		)
			throw new DatabaseRestoreError('operator-action-not-allowed');
		if (action === 'resume') {
			const measured = await this.targets.resourceView(path.dirname(this.workspace.root));
			const policy = await this.targets.policy();
			const reason = measured.sample
				? internalResourceReason(
						measured.sample,
						row.artifact.bytes,
						row.artifact.engine === 'mysql'
							? Math.min(policy.maxSqlBytes, 128 * 1024 ** 2)
							: policy.maxSqlBytes,
						row.artifact.engine,
						'resume'
					)
				: 'capacity-unknown';
			if (reason || (row.artifact.engine === 'mysql' && !measured.sample?.operatorObservedAt))
				throw new DatabaseRestoreError(`resource-${reason || 'capacity-unknown'}`);
		}
		await this.targets.request(row, action);
		return { requested: true, automatic: !!this.targets.automatic };
	}
	tick() {
		if (this.running) {
			const row = this.store.get(this.running.id);
			if (row && row.expiresAt <= Date.now()) {
				this.store.requestDelete(row.id);
				this.running.controller.abort();
			}
		}
		if (this.running || this.stopping) return Promise.resolve();
		return (this.ticking ||= this.dispatch().finally(() => {
			this.ticking = undefined;
		}));
	}
	private async dispatch() {
		for (let row of this.store.pending()) {
			// Reconcile old prematurely finalized history against the full authenticated
			// host receipt. Never recreate/import/delete anything from a Deleted row.
			if (row.status === 'deleted') {
				await this.targets.automatic?.receipt(row.id);
				continue;
			}
			if (
				row.mode === 'internal' &&
				row.stage === 'checking-resources' &&
				this.targets.automatic &&
				!this.targets.automatic.record(row.id)
			) {
				try {
					await this.targets.request(row, row.cancelRequested ? 'delete' : 'provision');
				} catch {
					/* Keep the denied/unavailable request visible; no legacy/manual fallback. */
				}
			}
			if (row.expiresAt <= Date.now() && !row.cancelRequested)
				row = this.store.update(row.id, {
					status: 'expired',
					cancelRequested: true,
					cleanup: 'requested',
				});
			if (row.mode === 'internal' && this.targets.automatic?.record(row.id)) {
				const lifecycle = this.targets.automatic;
				const record = lifecycle.record(row.id)!;
				try {
					// Replay only the durable operation, never replay an uncertain SQL import.
					await lifecycle.persistent(
						row,
						row.cancelRequested ? 'delete' : record.action,
						row.cleanup === 'infrastructure_pending',
						true
					);
				} catch {
					/* Keep durable cancellation and retry only the bounded host intent. */
				}
				const receipt = await lifecycle.receipt(row.id);
				if (receipt?.state === 'removed' && row.cancelRequested && !this.store.lease(row.id)) {
					this.store.finishDeleted(row.id);
					continue;
				}
				if (receipt?.state === 'cleanup-required') {
					this.store.update(row.id, {
						stage: 'host-ownership-unverified',
						...(row.status !== 'provisioning_required'
							? { status: 'cleanup_required' as const, cleanup: 'uncertain' as const }
							: {}),
						errorCode: receipt.code || 'host-ownership-unverified',
					});
					continue; // No import, inspection approval or native SQL deletion on uncertain infrastructure.
				}
				if (
					(receipt?.state === 'ready' || receipt?.state === 'stopped') &&
					row.stage === 'host-ownership-unverified' &&
					row.completedAt &&
					!row.cancelRequested
				) {
					// A consumed-before-Start failure must recover to Stopped for a NEW
					// explicit Resume, never to automatic Start or SQL replay. Recheck
					// exact binding, fresh host observation, validated lease and cancellation.
					try {
						const approval = await this.targets.assertBinding(row, this.store.approval(row.id));
						const state = await this.targets.state(approval);
						const latest = this.store.get(row.id),
							lease = this.store.lease(row.id);
						const status = receipt.state === 'stopped' ? 'stopped' : 'active';
						if (
							!latest ||
							latest.cancelRequested ||
							latest.expiresAt <= Date.now() ||
							latest.stage !== 'host-ownership-unverified' ||
							!latest.completedAt ||
							receipt.observedAt < Date.now() - 30000 ||
							state.state !== status ||
							!lease ||
							lease.state !== 'validated' ||
							lease.restoreId !== latest.id ||
							lease.targetId !== latest.targetId ||
							lease.ownerToken !== latest.ownerToken ||
							lease.database !== latest.database
						)
							continue;
						row = this.store.update(row.id, {
							status,
							stage: status,
							cleanup: 'none',
							errorCode: null,
						});
					} catch {
						continue;
					} // Unknown ownership cannot authorize recovery or cleanup.
				}
				if (row.status === 'provisioning_required' && receipt) {
					row = this.store.update(row.id, { stage: receipt.state, errorCode: receipt.code });
				}
				if (
					row.status === 'provisioning_required' &&
					!row.cancelRequested &&
					(receipt?.state !== 'ready' ||
						receipt.observedAt < Date.now() - 30000 ||
						!(await lifecycle.capability()).available)
				)
					continue;
			}
			if (row.mode === 'internal' && row.encryptedApproval) {
				try {
					const approval = this.store.approval(row.id),
						state = await this.targets.state(approval);
					if (
						state.state === 'removed' &&
						row.cleanup === 'infrastructure_pending' &&
						!this.store.lease(row.id) &&
						!this.targets.automatic?.record(row.id)
					) {
						this.store.finishDeleted(row.id);
						continue;
					}
					await this.targets.assertBinding(row, approval);
					if (
						!row.cancelRequested &&
						['active', 'stopped'].includes(row.status) &&
						state.state !== 'removed'
					)
						row = this.store.update(row.id, {
							status: state.state === 'stopped' ? 'stopped' : 'active',
						});
				} catch {
					/* Unknown infrastructure is retained, never treated as deleted. */
				}
			}
			if (
				row.mode === 'internal' &&
				!row.encryptedApproval &&
				row.cancelRequested &&
				!this.store.lease(row.id) &&
				(await this.targets.verifiedAbsent(row))
			) {
				this.store.finishDeleted(row.id);
				continue;
			}
			if (row.status === 'provisioning_required' && !row.cancelRequested) {
				try {
					const approval = await this.targets.assertBinding(row);
					await this.targets.admission(approval, row, path.dirname(this.workspace.root));
					this.store.assertNotSource(approval);
					this.store.bind(row.id, approval);
					row = this.store.update(row.id, { status: 'queued', errorCode: null });
				} catch (error) {
					this.store.update(row.id, { errorCode: this.code(error) });
					continue;
				}
			}
			if (row.cleanup === 'infrastructure_pending') continue;
			const claimed = this.store.claim(row.id, row.cancelRequested);
			if (!claimed) continue;
			const controller = new AbortController();
			const done = Promise.resolve().then(() =>
				claimed.cancelRequested ? this.cleanup(claimed) : this.execute(claimed, controller.signal)
			);
			this.running = { id: row.id, controller, done };
			void done
				.catch(error => {
					this.log(claimed, error);
					this.store.update(claimed.id, {
						status: 'cleanup_required',
						cleanup: 'uncertain',
						cancelRequested: true,
						errorCode: 'reconciliation-required',
					});
				})
				.finally(() => {
					this.running = undefined;
				});
			return;
		}
	}
	private code(error: unknown) {
		return error instanceof DatabaseRestoreError || error instanceof RecoveryTestError
			? error.code
			: 'operation-failed';
	}
	private log(row: DatabaseRestore, error: unknown) {
		planLogger('restore', row.planId, row.backupId).warn(
			{
				event: 'persistent_database_restore_failed',
				restoreId: row.id,
				stage: this.store.get(row.id)?.stage,
				code: this.code(error),
			},
			'Persistent database restore failed.'
		);
	}
	private async client(row: DatabaseRestore) {
		const approval = await this.targets.assertBinding(row, this.store.approval(row.id));
		this.store.assertNotSource(approval);
		return { approval, client: this.importer(approval, await this.targets.ca(approval)) };
	}
	private async execute(row: DatabaseRestore, signal: AbortSignal) {
		let directory: string | undefined;
		try {
			directory = await this.workspace.create(row.id);
			const metadata = await this.recovery.testMetadata(row.backupId, row.planId, row.snapshotId);
			if (recoveryMetadataToken(metadata) !== row.metadataToken)
				throw new DatabaseRestoreError('snapshot-metadata-changed');
			const { approval, client } = await this.client(row);
			await this.targets.admission(approval, row, path.dirname(this.workspace.root));
			await this.recovery.databaseRestoreArtifact(
				{ ...row, sha256: row.artifact.sha256 },
				path.join(directory, 'files'),
				signal,
				async () => {
					await this.workspace.assert(row.id);
				}
			);
			const artifact = { ...row.artifact };
			const file = await validateRecoveryArtifact(artifact, path.join(directory, 'files'), signal);
			if (this.store.get(row.id)?.cancelRequested || signal.aborted)
				throw new DatabaseRestoreError('cancelled');
			// Revalidate approval and resource admission immediately before native CREATE/import.
			await this.client(row);
			await this.targets.admission(approval, row, path.dirname(this.workspace.root));
			if (this.store.busy(row.id)) throw new DatabaseRestoreError('database-workload-busy');
			if (row.expiresAt <= Date.now()) throw new DatabaseRestoreError('restore-expired');
			const restore = (current: AbortSignal) =>
				client.restore({ ...row, artifact }, file, directory!, current, stage => {
					this.store.update(row.id, { stage });
				});
			const inspection =
				row.mode === 'internal'
					? await withRecoveryResourceGuard(
							signal,
							async () => {
								try {
									await this.targets.admission(approval, row, path.dirname(this.workspace.root));
								} catch {
									throw new RecoveryTestError('database-import', 'internal-resources-insufficient');
								}
							},
							restore
						)
					: await restore(signal);
			if (signal.aborted || this.store.get(row.id)?.cancelRequested)
				throw new DatabaseRestoreError('cancelled');
			if (row.expiresAt <= Date.now()) throw new DatabaseRestoreError('restore-expired');
			await this.workspace.remove(row.id);
			directory = undefined;
			this.store.update(row.id, {
				status: 'active',
				stage: 'active',
				inspection,
				lastValidatedAt: Date.now(),
				completedAt: Date.now(),
				cleanup: 'none',
				errorCode: null,
			});
		} catch (error) {
			this.log(row, error);
			this.store.update(row.id, {
				cancelRequested: true,
				errorCode: this.code(error),
				failureCode: this.code(error),
				failureStage:
					(error instanceof RecoveryTestError || error instanceof DatabaseRestoreError) &&
					error.stage
						? error.stage
						: this.store.get(row.id)?.stage,
				cleanup: 'requested',
			});
			await this.cleanup(this.store.get(row.id)!, directory);
		}
	}
	private async cleanup(row: DatabaseRestore, existingDirectory?: string) {
		let directory = existingDirectory;
		try {
			// A stopped/expired target must be resumable for exact ownership cleanup, never approved for early physical deletion.
			if (row.mode === 'internal') await this.targets.request(row, 'delete', false);
			if (!directory) {
				try {
					directory = await this.workspace.assert(row.id);
				} catch {
					directory = await this.workspace.create(row.id);
				}
			}
			if (row.encryptedApproval) {
				const { client } = await this.client(row);
				await client.removeOwned(row, directory);
			} else if (row.mode === 'internal') {
				// Target might have been provisioned concurrently. Never infer physical absence from a missing credential.
				try {
					const approval = await this.targets.assertBinding(row);
					this.store.bind(row.id, approval);
					throw new DatabaseRestoreError('target-reconciliation-required');
				} catch (error) {
					if (this.code(error) !== 'operator-target-unavailable') throw error;
				}
				await this.targets.request(row, 'delete', false);
				throw new DatabaseRestoreError('operator-absence-verification-required');
			}
			await this.workspace.remove(row.id);
			directory = undefined;
			if (row.mode === 'internal') {
				const latest = this.store.update(row.id, {
					status: 'cleanup_required',
					stage: 'operator-cleanup',
					cleanup: 'infrastructure_pending',
				});
				await this.targets.request(latest, 'delete', true);
			} else this.store.finishDeleted(row.id);
		} catch (error) {
			this.log(row, error);
			this.store.update(row.id, {
				status: 'cleanup_required',
				cleanup: 'uncertain',
				errorCode: this.code(error),
			});
		} finally {
			if (directory)
				try {
					await this.workspace.remove(row.id);
				} catch {
					this.store.update(row.id, {
						status: 'cleanup_required',
						cleanup: 'uncertain',
						errorCode: 'workspace-cleanup-failed',
					});
				}
		}
	}
	async recoverInterrupted() {
		this.store.recoverInterrupted();
		await this.tick();
	}
	async idle() {
		await this.running?.done;
	}
	async shutdown() {
		this.stopping = true;
		if (this.running) {
			// Cancelling metadata-only inspection must not delete a previously retained restore.
			if (this.store.get(this.running.id)?.status === 'importing')
				this.store.requestDelete(this.running.id);
			this.running.controller.abort();
			await this.running.done;
		}
	}
}
