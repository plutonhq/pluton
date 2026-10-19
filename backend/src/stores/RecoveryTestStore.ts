import crypto from 'crypto';
import Cryptr from 'cryptr';
import { and, asc, desc, eq, inArray, sql, notExists, or, gt, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { DatabaseType } from '../db';
import { backups } from '../db/schema/backups';
import { plans } from '../db/schema/plans';
import { restores } from '../db/schema/restores';
import { remoteManagedRepositories } from '../db/schema/remoteManagedRepositories';
import {
	recoveryTests,
	recoveryTargets,
	recoveryTestPolicies,
	recoveryImportLeases,
	type RecoveryTest,
	type NewRecoveryTest,
	type RecoveryImportLease,
} from '../db/schema/recoveryTests';
import type {
	InternalRecoveryEngine,
	RecoveryEngine,
	RecoveryPolicy,
	RecoveryTarget,
	RecoveryTargetView,
} from '../types/recoveryTests';
import {
	defaultRecoveryPolicy,
	parseRecoveryInput,
	recoveryPolicySchema,
	recoveryTargetSchema,
} from '../utils/recoveryTestPolicy';
import { AppError, NotFoundError } from '../utils/AppError';
import {
	internalRecoverySessions,
	internalRecoveryImportLeases,
	type InternalRecoverySession,
} from '../db/schema/internalRecovery';

const active = ['queued', 'running'] as const;
export class RecoveryTestStore {
	constructor(
		private readonly db: DatabaseType,
		private readonly secret: string
	) {}

	async get(id: string): Promise<RecoveryTest | null> {
		return this.db.select().from(recoveryTests).where(eq(recoveryTests.id, id)).get() || null;
	}
	async activity() {
		return {
			backup: !!this.db
				.select({ id: backups.id })
				.from(backups)
				.where(eq(backups.inProgress, true))
				.get(),
			restore: !!this.db
				.select({ id: restores.id })
				.from(restores)
				.where(eq(restores.inProgress, true))
				.get(),
			recovery: !!this.db
				.select({ id: recoveryTests.id })
				.from(recoveryTests)
				.where(eq(recoveryTests.status, 'running'))
				.get(),
		};
	}
	async list(planId: string, backupIds: string[] = []): Promise<RecoveryTest[]> {
		const recent = this.db
			.select()
			.from(recoveryTests)
			.where(eq(recoveryTests.planId, planId))
			.orderBy(desc(recoveryTests.createdAt), desc(sql`rowid`))
			.limit(200)
			.all();
		if (!backupIds.length) return recent;
		// Keep the latest result for every displayed backup, even after many
		// manual retests push it outside the bounded recent-attempt history.
		const newer = alias(recoveryTests, 'newer');
		return this.db
			.select()
			.from(recoveryTests)
			.where(
				and(
					eq(recoveryTests.planId, planId),
					or(
						inArray(
							recoveryTests.id,
							recent.map(row => row.id)
						),
						and(
							inArray(recoveryTests.backupId, backupIds),
							notExists(
								this.db
									.select({ id: newer.id })
									.from(newer)
									.where(
										and(
											eq(newer.planId, recoveryTests.planId),
											eq(newer.backupId, recoveryTests.backupId),
											or(
												gt(newer.createdAt, recoveryTests.createdAt),
												and(
													eq(newer.createdAt, recoveryTests.createdAt),
													sql`newer.rowid > recovery_tests.rowid`
												)
											)
										)
									)
							)
						)
					)
				)
			)
			.orderBy(desc(recoveryTests.createdAt), desc(sql`recovery_tests.rowid`))
			.all();
	}
	async update(id: string, changes: Partial<RecoveryTest>) {
		return this.db
			.update(recoveryTests)
			.set(changes)
			.where(eq(recoveryTests.id, id))
			.returning()
			.get();
	}
	async policy(planId: string): Promise<RecoveryPolicy> {
		return (
			this.db
				.select()
				.from(recoveryTestPolicies)
				.where(eq(recoveryTestPolicies.planId, planId))
				.get()?.policy || defaultRecoveryPolicy
		);
	}
	async savePolicy(planId: string, input: unknown): Promise<RecoveryPolicy> {
		const policy = parseRecoveryInput(recoveryPolicySchema, input);
		return this.db.transaction(tx => {
			if (!tx.select().from(plans).where(eq(plans.id, planId)).get())
				throw new NotFoundError('Plan not found.');
			const previous = tx
				.select()
				.from(recoveryTestPolicies)
				.where(eq(recoveryTestPolicies.planId, planId))
				.get()?.policy;
			const saved = {
				...policy,
				// An older UI saving a policy must not silently reset target selection.
				targetModes: policy.targetModes ?? previous?.targetModes,
				enabledAt: policy.enabled
					? previous?.enabled
						? previous.enabledAt
						: Math.floor(Date.now() / 1000) * 1000
					: undefined,
			};
			if (saved.enabled && Object.values(saved.targetModes || {}).includes('internal'))
				throw new AppError(
					400,
					'Internal targets require manual operator activation and cleanup. Disable after-backup automation before selecting Internal.'
				);
			tx.insert(recoveryTestPolicies)
				.values({ planId, policy: saved })
				.onConflictDoUpdate({
					target: recoveryTestPolicies.planId,
					set: { policy: saved },
				})
				.run();
			return saved;
		});
	}
	async targets(planId: string): Promise<RecoveryTargetView[]> {
		return this.db
			.select()
			.from(recoveryTargets)
			.where(eq(recoveryTargets.planId, planId))
			.all()
			.map(row => ({ ...row.config, passwordConfigured: !!row.encryptedPassword }));
	}
	async saveTarget(planId: string, input: unknown): Promise<void> {
		const parsed = parseRecoveryInput(recoveryTargetSchema, input);
		const { password, ...config } = parsed;
		this.db.transaction(tx => {
			if (
				tx
					.select()
					.from(recoveryTests)
					.where(and(eq(recoveryTests.planId, planId), inArray(recoveryTests.status, [...active])))
					.get()
			)
				throw new AppError(409, 'Wait for the recovery test to finish before changing its target.');
			const previous = tx
				.select()
				.from(recoveryTargets)
				.where(and(eq(recoveryTargets.planId, planId), eq(recoveryTargets.engine, config.engine)))
				.get();
			if (
				previous &&
				tx
					.select()
					.from(recoveryImportLeases)
					.where(eq(recoveryImportLeases.targetId, previous.id))
					.get()
			)
				throw new AppError(
					409,
					'Resolve the outstanding recovery database cleanup before changing this target.'
				);
			if (!tx.select().from(plans).where(eq(plans.id, planId)).get())
				throw new NotFoundError('Plan not found.');
			const encryptedPassword = password
				? new Cryptr(this.secret).encrypt(password)
				: previous?.encryptedPassword;
			if (!encryptedPassword)
				throw new AppError(400, 'A separate recovery target password is required.');
			tx.insert(recoveryTargets)
				.values({
					id: previous?.id || crypto.randomBytes(12).toString('hex'),
					planId,
					engine: config.engine,
					config,
					encryptedPassword,
				})
				.onConflictDoUpdate({
					target: [recoveryTargets.planId, recoveryTargets.engine],
					set: { config, encryptedPassword },
				})
				.run();
		});
	}
	async target(
		planId: string,
		engine: RecoveryEngine
	): Promise<(RecoveryTarget & { id: string }) | null> {
		const row = this.db
			.select()
			.from(recoveryTargets)
			.where(and(eq(recoveryTargets.planId, planId), eq(recoveryTargets.engine, engine)))
			.get();
		if (!row?.config.enabled) return null;
		return this.materialize(row);
	}
	async leaseTarget(targetId: string): Promise<RecoveryTarget | null> {
		if (targetId.startsWith('irt_')) {
			const session = await this.internalSession(targetId);
			if (!session || session.releasedAt) return null;
			const { id: _id, ...target } = this.materialize(session);
			return target;
		}
		const row = this.db
			.select()
			.from(recoveryTargets)
			.where(eq(recoveryTargets.id, targetId))
			.get();
		if (!row) return null;
		const { id: _id, ...target } = this.materialize(row);
		return target;
	}
	async assertPlanRemovable(planId: string): Promise<void> {
		if (
			this.db
				.select()
				.from(internalRecoverySessions)
				.innerJoin(recoveryTests, eq(recoveryTests.id, internalRecoverySessions.testId))
				.where(and(eq(recoveryTests.planId, planId), isNull(internalRecoverySessions.releasedAt)))
				.get()
		)
			throw new AppError(
				409,
				'Resolve internal recovery infrastructure cleanup before removing this plan.'
			);
		if (
			this.db
				.select()
				.from(recoveryTests)
				.where(and(eq(recoveryTests.planId, planId), inArray(recoveryTests.status, [...active])))
				.get() ||
			this.db
				.select()
				.from(recoveryImportLeases)
				.innerJoin(recoveryTests, eq(recoveryTests.id, recoveryImportLeases.testId))
				.where(eq(recoveryTests.planId, planId))
				.get()
		)
			throw new AppError(409, 'Finish recovery testing and its cleanup before removing this plan.');
	}
	async requestCancellation(id: string): Promise<RecoveryTest | null> {
		return this.db.transaction(tx => {
			const row = tx.select().from(recoveryTests).where(eq(recoveryTests.id, id)).get();
			if (!row || !active.includes(row.status as (typeof active)[number])) return row || null;
			return tx
				.update(recoveryTests)
				.set({
					cancelRequested: true,
					...(row.status === 'queued'
						? {
								status: 'cancelled' as const,
								completedAt: new Date(),
								failureStage: 'job' as const,
								failureCode: 'cancelled' as const,
							}
						: {}),
				})
				.where(eq(recoveryTests.id, id))
				.returning()
				.get();
		});
	}
	async cleanupCandidates(): Promise<RecoveryTest[]> {
		return this.db
			.select()
			.from(recoveryTests)
			.all()
			.filter(
				row =>
					!active.includes(row.status as (typeof active)[number]) &&
					row.warnings.some(
						warning =>
							warning.code === 'workspace-cleanup-failed' || warning.code === 'unsafe-workspace'
					)
			);
	}
	private materialize(
		row: Pick<typeof recoveryTargets.$inferSelect, 'id' | 'config' | 'encryptedPassword'>
	): RecoveryTarget & { id: string } {
		try {
			const target = parseRecoveryInput(recoveryTargetSchema, {
				...row.config,
				password: new Cryptr(this.secret).decrypt(row.encryptedPassword),
			});
			if (!target.password) throw new Error();
			return { ...target, password: target.password, id: row.id };
		} catch {
			throw new AppError(409, 'Recovery target credentials are unavailable.');
		}
	}

	async enqueue(row: NewRecoveryTest): Promise<RecoveryTest> {
		return this.db.transaction(tx => {
			const backup = tx.select().from(backups).where(eq(backups.id, row.backupId)).get();
			const plan = tx.select().from(plans).where(eq(plans.id, row.planId)).get();
			const repo = tx
				.select()
				.from(remoteManagedRepositories)
				.where(eq(remoteManagedRepositories.id, row.repositoryId))
				.get();
			if (
				!backup ||
				!plan ||
				!repo ||
				backup.planId !== row.planId ||
				repo.planId !== row.planId ||
				backup.completionStats?.snapshot_id !== row.snapshotId ||
				!/^[a-f0-9]{64}$/.test(row.snapshotId) ||
				backup.status !== 'completed' ||
				backup.inProgress ||
				backup.success === false ||
				backup.method !== 'backup' ||
				backup.sourceType !== 'device' ||
				backup.sourceId === 'main' ||
				backup.storageId !== repo.storageId ||
				backup.storagePath !== repo.storagePath ||
				plan.storageId !== repo.storageId ||
				plan.storagePath !== repo.storagePath ||
				!repo.initializedAt
			)
				throw new AppError(409, 'Recovery snapshot binding is unavailable.');
			if (row.automationKey) {
				const prior = tx
					.select()
					.from(recoveryTests)
					.where(eq(recoveryTests.automationKey, row.automationKey))
					.get();
				if (prior) return prior;
			}
			const current = tx
				.select()
				.from(recoveryTests)
				.where(
					and(eq(recoveryTests.planId, row.planId), inArray(recoveryTests.status, [...active]))
				)
				.get();
			if (current) {
				if (row.policy.snapshotMetadataToken)
					throw new AppError(
						409,
						'A recovery test is already queued or running. Review its result before submitting another confirmation.'
					);
				if (current.backupId === row.backupId && current.snapshotId === row.snapshotId)
					return current;
				throw new AppError(409, 'One recovery test is already queued or running for this plan.');
			}
			return tx.insert(recoveryTests).values(row).returning().get();
		});
	}
	/** One global worker, claimed transactionally even if multiple ticks arrive. */
	async claim(): Promise<RecoveryTest | null> {
		return this.db.transaction(tx => {
			if (tx.select().from(recoveryTests).where(eq(recoveryTests.status, 'running')).get() ||
				tx.get(sql`SELECT 1 FROM persistent_database_restores WHERE status IN ('importing','deleting') LIMIT 1`))
				return null;
			// Recovery yields to existing backup/restore work. It never pauses backups
			// or retries a refused import in a tight loop. Check again on the next tick.
			if (
				tx.select().from(backups).where(eq(backups.inProgress, true)).get() ||
				tx.select().from(restores).where(eq(restores.inProgress, true)).get()
			)
				return null;
			const pendingInternal = !!tx
				.select()
				.from(internalRecoverySessions)
				.where(isNull(internalRecoverySessions.releasedAt))
				.get();
			const row = tx
				.select()
				.from(recoveryTests)
				.where(eq(recoveryTests.status, 'queued'))
				.orderBy(asc(recoveryTests.createdAt))
				.all()
				.find(value => !pendingInternal || value.policy.databaseImport === 'disabled');
			if (!row) return null;
			return (
				tx
					.update(recoveryTests)
					.set({ status: 'running', startedAt: new Date() })
					.where(and(eq(recoveryTests.id, row.id), eq(recoveryTests.status, 'queued')))
					.returning()
					.get() || null
			);
		});
	}
	async automaticCandidates() {
		const policies = this.db
			.select()
			.from(recoveryTestPolicies)
			.all()
			.filter(
				row =>
					row.policy.enabled && !Object.values(row.policy.targetModes || {}).includes('internal')
			);
		const candidates: string[] = [];
		for (const row of policies) {
			if (
				this.db
					.select()
					.from(recoveryTests)
					.where(
						and(eq(recoveryTests.planId, row.planId), inArray(recoveryTests.status, [...active]))
					)
					.get()
			)
				continue;
			const history = this.db
				.select()
				.from(backups)
				.where(and(eq(backups.planId, row.planId), eq(backups.status, 'completed')))
				.orderBy(asc(backups.ended))
				.all();
			for (const backup of history) {
				const snapshot = backup.completionStats?.snapshot_id;
				if (
					!backup.inProgress &&
					backup.success !== false &&
					backup.ended &&
					backup.ended.getTime() >= (row.policy.enabledAt || Number.MAX_SAFE_INTEGER) &&
					snapshot &&
					/^[a-f0-9]{64}$/.test(snapshot) &&
					!this.db
						.select()
						.from(recoveryTests)
						.where(
							and(eq(recoveryTests.backupId, backup.id), eq(recoveryTests.snapshotId, snapshot))
						)
						.get()
				) {
					candidates.push(backup.id);
					break;
				}
			}
		}
		return candidates;
	}
	async interrupted() {
		const rows = this.db
			.select()
			.from(recoveryTests)
			.where(eq(recoveryTests.status, 'running'))
			.all();
		for (const row of rows)
			await this.update(row.id, {
				status: row.cancelRequested ? 'cancelled' : 'failed',
				completedAt: new Date(),
				failureStage: 'job',
				failureCode: 'interrupted',
			});
		return rows;
	}
	async leases(testId?: string): Promise<RecoveryImportLease[]> {
		const custom = testId
			? this.db
					.select()
					.from(recoveryImportLeases)
					.where(eq(recoveryImportLeases.testId, testId))
					.all()
			: this.db.select().from(recoveryImportLeases).all();
		const internal = testId
			? this.db
					.select()
					.from(internalRecoveryImportLeases)
					.where(eq(internalRecoveryImportLeases.testId, testId))
					.all()
			: this.db.select().from(internalRecoveryImportLeases).all();
		return [...custom, ...internal];
	}
	async addLease(lease: RecoveryImportLease) {
		if (lease.targetId.startsWith('irt_')) {
			const session = await this.internalSession(lease.targetId);
			if (
				!session ||
				session.testId !== lease.testId ||
				session.releasedAt ||
				session.cleanupReady ||
				!/^[a-f0-9]{24}$/.test(lease.id) ||
				!/^[a-f0-9]{48}$/.test(lease.ownerToken)
			)
				throw new AppError(409, 'Internal recovery activation is unavailable.');
			// The importer retains this object for immediate, ownership-checked cleanup.
			lease.id = `il_${lease.id}`;
			this.db.insert(internalRecoveryImportLeases).values(lease).run();
			return;
		}
		this.db.insert(recoveryImportLeases).values(lease).run();
	}
	async removeLease(id: string) {
		if (id.startsWith('il_')) {
			this.db
				.delete(internalRecoveryImportLeases)
				.where(eq(internalRecoveryImportLeases.id, id))
				.run();
			return;
		}
		this.db.delete(recoveryImportLeases).where(eq(recoveryImportLeases.id, id)).run();
	}
	async internalSession(id: string): Promise<InternalRecoverySession | null> {
		return (
			this.db
				.select()
				.from(internalRecoverySessions)
				.where(eq(internalRecoverySessions.id, id))
				.get() || null
		);
	}
	async pendingInternalSessions(): Promise<InternalRecoverySession[]> {
		return this.db
			.select()
			.from(internalRecoverySessions)
			.where(isNull(internalRecoverySessions.releasedAt))
			.all();
	}
	async beginInternalSession(input: {
		testId: string;
		engine: InternalRecoveryEngine;
		installationId: string;
		activationId: string;
		target: RecoveryTarget;
		caSha256: string;
	}): Promise<RecoveryTarget & { id: string }> {
		const { password, ...config } = parseRecoveryInput(recoveryTargetSchema, input.target);
		if (!password || config.engine !== input.engine || config.tls !== 'verify-identity')
			throw new AppError(409, 'Unsafe internal target.');
		const id = `irt_${crypto.randomBytes(12).toString('hex')}`;
		this.db.transaction(tx => {
			const test = tx.select().from(recoveryTests).where(eq(recoveryTests.id, input.testId)).get();
			if (
				!test ||
				test.status !== 'running' ||
				test.policy.databaseImport !== 'required' ||
				test.policy.targetModes?.[input.engine] !== 'internal' ||
				!/^[a-f0-9]{32}$/.test(input.installationId) ||
				!/^[a-f0-9]{32}$/.test(input.activationId) ||
				!/^[a-f0-9]{64}$/.test(input.caSha256)
			)
				throw new AppError(409, 'Internal recovery activation is unavailable.');
			tx.insert(internalRecoverySessions)
				.values({
					id,
					testId: input.testId,
					engine: input.engine,
					installationId: input.installationId,
					activationId: input.activationId,
					config,
					encryptedPassword: new Cryptr(this.secret).encrypt(password),
					caSha256: input.caSha256,
				})
				.run();
		});
		return { ...config, password, id };
	}
	async markInternalCleanupReady(id: string) {
		const session = await this.internalSession(id);
		if (!session || (await this.leases(session.testId)).length)
			throw new AppError(409, 'Database cleanup is incomplete.');
		this.db
			.update(internalRecoverySessions)
			.set({ cleanupReady: true })
			.where(eq(internalRecoverySessions.id, id))
			.run();
	}
	async completeInternalCleanup(id: string, changes: Partial<RecoveryTest>) {
		this.db.transaction(tx => {
			const session = tx
				.select()
				.from(internalRecoverySessions)
				.where(eq(internalRecoverySessions.id, id))
				.get();
			if (
				!session?.cleanupReady ||
				tx
					.select()
					.from(internalRecoveryImportLeases)
					.where(eq(internalRecoveryImportLeases.testId, session.testId))
					.get() ||
				tx
					.select()
					.from(recoveryImportLeases)
					.where(eq(recoveryImportLeases.testId, session.testId))
					.get()
			)
				throw new AppError(409, 'Database cleanup is incomplete.');
			tx.update(recoveryTests).set(changes).where(eq(recoveryTests.id, session.testId)).run();
			tx.update(internalRecoverySessions)
				.set({ releasedAt: new Date() })
				.where(eq(internalRecoverySessions.id, id))
				.run();
		});
	}
}
