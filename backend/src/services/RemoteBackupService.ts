import crypto from 'crypto';
import { remoteBackupFailure } from '../utils/remoteBackupDiagnostics';
import Cryptr from 'cryptr';
import { Plan, NewPlan } from '../db/schema/plans';
import { type AgentCommand, type AgentIdentity } from '../db/schema/agents';
import { type NewBackup } from '../db/schema/backups';
import { AgentStore } from '../stores/AgentStore';
import { BackupStore } from '../stores/BackupStore';
import { PlanStore } from '../stores/PlanStore';
import { RemoteManagedRepositoryStore } from '../stores/RemoteManagedRepositoryStore';
import { StorageStore } from '../stores/StorageStore';
import { CronManager } from '../managers/CronManager';
import { BackupEventService } from './events/BackupEventService';
import { intervalToCron } from '../utils/intervalToCron';
import { AppError, NotFoundError } from '../utils/AppError';
import { generateUID } from '../utils/helpers';
import type { PlanAddRunSettings, PlanSource } from '../types/plans';
import type { BackupCompletionStats } from '../types/backups';
import { projectRemoteProgress, type RemoteProgressEvent } from '../utils/remoteBackupProgress';
import { configService } from './ConfigService';
import {
	materializeRemoteLifecycle,
	materializeRemoteLifecycleCollection,
	parseRemoteLifecycle,
	lifecycleDatabases,
} from '../utils/remoteLifecycle';
import type { DatabaseArtifact, LifecycleWarning } from '../types/remoteLifecycle';
import { serverLogger } from '../utils/logger';
import type { ManagedReplicationCompletionHook } from './ManagedReplicationService';
import {
	RemoteCommandPreparationError,
	type RemoteCommandPreparationFailure,
	type RemoteCommandPreparationRuleCategory,
	type RemoteCommandPreparationStage,
} from './remoteCommandPreparation';

export { RemoteCommandPreparationError } from './remoteCommandPreparation';

const MINIMUM_AGENT_VERSION = [0, 2, 0] as const;
const MAX_SOURCE_PATH_LENGTH = 4_096;

/**
 * The first agent transport deliberately supports only the password-auth SFTP
 * settings already used by the standard storage form. Do not pass generic
 * rclone settings through this boundary: several SFTP options can execute an
 * external SSH binary or remote shell command, and agent-local file paths
 * would not be portable or safe to materialize.
 */
const SFTP_AGENT_OPTION_KEYS = new Set(['host', 'port', 'user', 'pass']);

type CommandReference = { backupId: string; planId: string; repositoryId: string };

type PreparationStageDetails = {
	rejectedField?: string;
	ruleCategory?: RemoteCommandPreparationRuleCategory;
};

type SetPreparationStage = (
	stage: RemoteCommandPreparationStage,
	details?: PreparationStageDetails
) => void;

type RemoteCompletion = {
	success: boolean;
	cancelled?: boolean;
	error?: string;
	/** Closed, non-secret diagnostics sent by the Phase 4 agent. */
	failureStage?: string;
	failureCode?: string;
	databaseId?: string;
	engine?: 'mysql' | 'mariadb' | 'postgresql';
	result?: {
		sourcePaths?: string[];
		snapshotId?: string;
		summary?: BackupCompletionStats;
		lifecycle?: {
			warnings: LifecycleWarning[];
			database?: { path: string; bytes: number; sha256: string };
			databases?: DatabaseArtifact[];
		};
	};
};

function versionAtLeast(value: string): boolean {
	const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
	if (!match) return false;
	const actual = [Number(match[1]), Number(match[2]), Number(match[3])];
	for (let index = 0; index < MINIMUM_AGENT_VERSION.length; index += 1) {
		if (actual[index] > MINIMUM_AGENT_VERSION[index]) return true;
		if (actual[index] < MINIMUM_AGENT_VERSION[index]) return false;
	}
	return true;
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

function hasUnsafeControlCharacters(value: string): boolean {
	for (const character of value) {
		const code = character.charCodeAt(0);
		if (code <= 0x1f || code === 0x7f) return true;
	}
	return false;
}

function validateAbsoluteLinuxPath(value: string): void {
	if (
		!value ||
		value.length > MAX_SOURCE_PATH_LENGTH ||
		!value.startsWith('/') ||
		hasUnsafeControlCharacters(value) ||
		value.split(/[\\/]+/).includes('..')
	) {
		throw new AppError(400, 'Remote backup source must be one safe absolute Linux path.');
	}
}

function validateRepositoryPath(value: string): void {
	if (!value || value.length > MAX_SOURCE_PATH_LENGTH || hasUnsafeControlCharacters(value)) {
		throw new AppError(400, 'Remote backup destination path is invalid.');
	}
	if (value.split(/[\\/]+/).includes('..')) {
		throw new AppError(400, 'Remote backup destination path cannot contain traversal.');
	}
}

function commandReference(payload: Record<string, unknown>): CommandReference {
	const backupId = payload.backupId;
	const planId = payload.planId;
	const repositoryId = payload.repositoryId;
	if (
		!isNonEmptyString(backupId) ||
		!isNonEmptyString(planId) ||
		!isNonEmptyString(repositoryId) ||
		Object.keys(payload).some(key => !['backupId', 'planId', 'repositoryId'].includes(key))
	) {
		throw new AppError(400, 'Remote backup command payload is invalid.');
	}
	return { backupId, planId, repositoryId };
}

function hasEnabledScripts(plan: Pick<Plan | NewPlan, 'settings'>): boolean {
	return Object.values(plan.settings?.scripts || {}).some(
		items => Array.isArray(items) && items.length > 0
	);
}

function toFiniteNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function isMeaningfulStorageValue(value: unknown): boolean {
	if (typeof value === 'string') return value.trim().length > 0;
	if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
	return value === true;
}

function isSafeSnapshotId(value: unknown): value is string {
	return typeof value === 'string' && /^[A-Fa-f0-9]{8,128}$/.test(value);
}

/**
 * A narrow orchestration path for a managed remote filesystem backup. It is
 * intentionally not a replacement for RemoteStrategy: repair, unlock, prune,
 * Local script execution and generic commands remain unavailable. Phase 5 adds
 * only optional declarative database dumps and administrator-deployed hooks.
 */
export class RemoteBackupService {
	private readonly cronManager: CronManager<any>;
	private readonly eventService: BackupEventService;
	private replicationService?: ManagedReplicationCompletionHook;

	constructor(
		private readonly repositories: RemoteManagedRepositoryStore,
		private readonly agentStore: AgentStore,
		private readonly planStore: PlanStore,
		private readonly backupStore: BackupStore,
		private readonly storageStore: StorageStore,
		private readonly encryptionSecret = configService.config.SECRET
	) {
		this.cronManager = CronManager.getInstance<any>({
			'remote-backup': async (planId: string) => this.queueScheduledBackup(planId),
		});
		this.eventService = new BackupEventService(planStore, backupStore);
	}

	static isRemoteFilesystemPlan(plan: Pick<Plan | NewPlan, 'sourceId' | 'sourceType'>): boolean {
		return plan.sourceType === 'device' && plan.sourceId !== 'main';
	}

	setReplicationService(service: ManagedReplicationCompletionHook): void {
		this.replicationService = service;
	}

	/** Internal server recovery shares the same narrow SFTP allowlist/decryption. */
	async getSftpRecoveryOptions(storageId: string): Promise<Record<string, string>> {
		return (await this.materializeSftpStorage(storageId)).options;
	}

	async validatePlanCreation(plan: NewPlan): Promise<void> {
		await this.assertSupportedPlan(plan);
	}

	async createManagedPlan(plan: Plan, runSettings?: PlanAddRunSettings): Promise<void> {
		await this.assertSupportedPlan(plan);
		const agent = await this.getCapableAgent(plan.sourceId);
		const existing = await this.repositories.getByPlanId(plan.id);
		if (existing) throw new AppError(409, 'Remote backup repository already exists for this plan.');
		const storagePath = plan.storagePath || '';
		validateRepositoryPath(storagePath);
		const password = crypto.randomBytes(32).toString('base64url');
		const encryptedPassword = new Cryptr(this.encryptionSecret).encrypt(password);
		await this.repositories.create({
			id: `remote-repo-${generateUID(20)}`,
			planId: plan.id,
			agentId: agent.agentId,
			storageId: plan.storageId as string,
			storagePath,
			encryptedPassword,
		});
		try {
			await this.ensureSchedule(plan);
			if (runSettings?.runNow ?? true) await this.queuePlanBackup(plan.id);
		} catch (error) {
			// Queue creation can fail after the scheduler has already persisted the
			// remote entry. Remove only this workflow's schedule; another scheduler
			// type may legitimately share the plan ID.
			await this.cronManager.removeSchedulesByType(plan.id, 'remote-backup');
			await this.repositories.deleteByPlanId(plan.id);
			throw error;
		}
	}

	async updateManagedPlan(plan: Plan): Promise<void> {
		await this.assertSupportedPlan(plan);
		const repository = await this.repositories.getByPlanId(plan.id);
		if (!repository) throw new NotFoundError('Managed remote repository was not found.');
		const agent = await this.getCapableAgent(plan.sourceId);
		if (repository.agentId !== agent.agentId) {
			throw new AppError(400, 'Changing a remote backup plan to another agent is not supported.');
		}
		await this.ensureSchedule(plan);
	}

	async removeManagedPlan(plan: Plan): Promise<{ storagePath: string }> {
		const repository = await this.repositories.getByPlanId(plan.id);
		if (!repository) throw new NotFoundError('Managed remote repository was not found.');
		const backups = ((await this.backupStore.getAll()) || []).filter(
			backup => backup.planId === plan.id && backup.inProgress
		);
		for (const backup of backups) {
			await this.agentStore.cancelCommand(`remote-backup-${backup.id}`);
			await this.eventService.onBackupCancelled({ planId: plan.id, backupId: backup.id });
		}
		await this.cronManager.removeSchedulesByType(plan.id, 'remote-backup');
		// PlanStore atomically escrows ciphertext and removes live repository/plan metadata.
		// Do not erase the only password before that transaction can commit.
		// This phase intentionally never deletes a remote Restic repository.
		return { storagePath: repository.storagePath };
	}

	async pausePlan(planId: string): Promise<boolean> {
		return this.cronManager.pauseSchedule(planId, 'remote-backup');
	}

	async resumePlan(planId: string): Promise<boolean> {
		return this.cronManager.resumeSchedule(planId, 'remote-backup');
	}

	async queuePlanBackup(planId: string): Promise<string> {
		const plan = await this.planStore.getById(planId);
		if (!plan) throw new NotFoundError('Plan not found.');
		await this.assertSupportedPlan(plan, undefined, false);
		if (!plan.isActive) return 'Remote backup plan is paused.';
		if (await this.planStore.hasActiveBackups(planId)) {
			throw new AppError(409, 'A backup is already in progress for this plan.');
		}
		const repository = await this.repositories.getByPlanId(planId);
		if (!repository) throw new NotFoundError('Managed remote repository was not found.');
		const agent = await this.getCapableAgent(plan.sourceId);
		if (agent.agentId !== repository.agentId)
			throw new AppError(409, 'Remote agent identity changed.');

		const backupId = generateUID();
		const backup: NewBackup = {
			id: backupId,
			status: 'queued',
			inProgress: true,
			started: new Date(),
			planId,
			storageId: plan.storageId,
			storagePath: repository.storagePath,
			sourceId: plan.sourceId,
			sourceType: plan.sourceType,
			sourceConfig: plan.sourceConfig,
			method: 'backup',
			encryption: true,
			compression: Boolean(plan.settings.compression),
			taskStats: null,
		};
		await this.repositories.createBackupAndCommand({
			backup,
			command: {
				id: `remote-backup-${backupId}`,
				agentId: agent.agentId,
				idempotencyKey: `remote-backup:${backupId}`,
				// Credentials and the repository password are materialized only at poll time.
				payload: { backupId, planId, repositoryId: repository.id },
			},
		});
		return 'Remote filesystem backup queued.';
	}

	async cancelBackup(
		planId: string,
		backupId: string
	): Promise<{ success: boolean; result: string }> {
		const backup = await this.backupStore.getById(backupId);
		const repository = await this.repositories.getByPlanId(planId);
		if (!backup || !repository || backup.planId !== planId || backup.sourceId === 'main') {
			throw new AppError(501, 'REMOTE_CAPABILITY_NOT_IMPLEMENTED');
		}
		if (!backup.inProgress) {
			throw new AppError(409, 'The remote backup is no longer in progress.');
		}
		await this.agentStore.cancelCommand(`remote-backup-${backupId}`);
		await this.eventService.onBackupCancelled({ planId, backupId });
		return { success: true, result: 'Remote backup cancellation requested.' };
	}

	async getBackupProgress(backupId: string) {
		const backup = await this.backupStore.getById(backupId);
		const repository = backup?.planId ? await this.repositories.getByPlanId(backup.planId) : null;
		if (!backup || !repository || backup.sourceId === 'main') {
			throw new AppError(501, 'REMOTE_CAPABILITY_NOT_IMPLEMENTED');
		}
		return projectRemoteProgress(backup);
	}

	/** Called during authenticated poll; returned data is never persisted in agent_commands. */
	async materializeCommand(
		agentId: string,
		command: AgentCommand
	): Promise<Record<string, unknown>> {
		if (command.type !== 'BACKUP_FILESYSTEM') return command.payload;
		const failure: RemoteCommandPreparationFailure = { stage: 'command-ownership' };
		const setStage: SetPreparationStage = (
			stage: RemoteCommandPreparationStage,
			details?: PreparationStageDetails
		): void => {
			failure.stage = stage;
			delete failure.rejectedField;
			delete failure.ruleCategory;
			if (details?.rejectedField) failure.rejectedField = details.rejectedField;
			if (details?.ruleCategory) failure.ruleCategory = details.ruleCategory;
		};
		try {
			if (command.agentId !== agentId)
				throw new AppError(403, 'Command does not belong to this agent.');
			setStage('command-reference');
			const reference = commandReference(command.payload);
			failure.backupId = reference.backupId;
			failure.planId = reference.planId;
			setStage('managed-records');
			const [repository, plan, backup] = await Promise.all([
				this.repositories.getById(reference.repositoryId),
				this.planStore.getById(reference.planId),
				this.backupStore.getById(reference.backupId),
			]);
			if (
				!repository ||
				!plan ||
				!backup ||
				backup.planId !== plan.id ||
				repository.planId !== plan.id ||
				!backup.inProgress ||
				backup.status === 'cancelled' ||
				backup.sourceId !== plan.sourceId
			) {
				setStage('managed-plan-consistency');
				throw new AppError(409, 'Remote backup command no longer has a valid managed plan.');
			}
			failure.storageId = repository.storageId;
			if (repository.agentId !== agentId) {
				setStage('repository-agent');
				throw new AppError(403, 'Managed repository belongs to another agent.');
			}
			if (repository.storageId !== plan.storageId || repository.storagePath !== plan.storagePath) {
				setStage('repository-metadata');
				throw new AppError(409, 'Managed repository metadata no longer matches the plan.');
			}
			await this.assertSupportedPlan(plan, setStage, false);
			setStage('repository-path');
			validateRepositoryPath(repository.storagePath);
			const storage = await this.materializeSftpStorage(repository.storageId, setStage);
			setStage('repository-secret-decryption');
			let repositoryPassword: string;
			try {
				repositoryPassword = new Cryptr(this.encryptionSecret).decrypt(
					repository.encryptedPassword
				);
			} catch {
				throw new AppError(500, 'Remote repository credentials could not be prepared.');
			}
			setStage('source-validation');
			const source = this.getSingleSource(plan.sourceConfig);
			const excludes = this.getSafeExcludes(plan.sourceConfig);
			let lifecycle;
			if (plan.settings.remoteLifecycle) {
				setStage('database-credential-preparation');
				const agent = await this.getCapableAgent(plan.sourceId);
				lifecycle =
					plan.settings.remoteLifecycle.version === 1
						? materializeRemoteLifecycle(
								plan.settings.remoteLifecycle,
								plan.settings.remoteLifecycle.database
									? await this.planStore.getDatabaseCredential(plan.id)
									: null,
								this.encryptionSecret
							)
						: materializeRemoteLifecycleCollection(
								plan.settings.remoteLifecycle,
								await this.planStore.getDatabaseCredentials(plan.id),
								this.encryptionSecret
							);
				const databases = lifecycleDatabases(lifecycle);
				if (
					(agent.capabilities as { backupLifecycleVersion?: number }).backupLifecycleVersion === 1
				) {
					const database = databases[0];
					const { databaseId: _id, ...legacyDatabase } = database || {};
					lifecycle = parseRemoteLifecycle({
						version: 1,
						...(database ? { database: legacyDatabase } : {}),
						preHook: lifecycle.preHook,
						postHook: lifecycle.postHook,
					});
				}
			}
			setStage('payload');
			return {
				version: lifecycle ? (lifecycle.version === 2 ? 3 : 2) : 1,
				...(lifecycle ? { lifecycle } : {}),
				backupId: backup.id,
				planId: plan.id,
				sourcePath: source,
				excludes,
				repository: {
					remoteName: 'pluton',
					path: repository.storagePath,
					initialize: !repository.initializedAt,
				},
				rclone: storage,
				repositoryPassword,
			};
		} catch (error) {
			if (error instanceof RemoteCommandPreparationError) throw error;
			// AgentService logs only RemoteCommandPreparationError.safeMessage.
			// Preserve the established internal AppError text for callers that need it,
			// but never retain arbitrary provider/decryption exception text.
			throw new RemoteCommandPreparationError(
				failure,
				error instanceof AppError ? error.message : undefined
			);
		}
	}

	async recordCommandEvent(
		command: AgentCommand,
		event: RemoteProgressEvent,
		sequence = command.lastEventSequence
	): Promise<void> {
		if (command.type !== 'BACKUP_FILESYSTEM') return;
		const reference = commandReference(command.payload);
		const updated = await this.backupStore.updateRemoteProgress(
			reference.backupId,
			reference.planId,
			command.id,
			command.attemptCount,
			sequence,
			event
		);
		if (!updated) return;
		if (event.lifecycleStage && serverLogger) {
			serverLogger.info(
				{
					agentEvent: 'backup_lifecycle_stage',
					planId: reference.planId,
					backupId: reference.backupId,
					lifecycleStage: event.lifecycleStage,
					...(event.databaseId
						? {
								databaseId: event.databaseId,
								engine: event.engine,
								ordinal: event.ordinal,
								count: event.count,
							}
						: {}),
				},
				'Remote backup lifecycle stage'
			);
		}
	}

	async completeCommand(command: AgentCommand, completion: RemoteCompletion): Promise<void> {
		if (command.type !== 'BACKUP_FILESYSTEM') return;
		const reference = commandReference(command.payload);
		const current = await this.backupStore.getById(reference.backupId);
		if (
			current &&
			['completed', 'failed', 'cancelled'].includes(current.status || '') &&
			!(current.status === 'cancelled' && completion.success && completion.result?.lifecycle)
		)
			return;
		if (
			(command.state === 'cancelled' || completion.cancelled) &&
			!(completion.success && completion.result?.lifecycle)
		) {
			await this.eventService.onBackupCancelled({
				planId: reference.planId,
				backupId: reference.backupId,
			});
			return;
		}
		if (!completion.success) {
			await this.eventService.onBackupFailure({
				planId: reference.planId,
				backupId: reference.backupId,
				error: remoteBackupFailure(completion),
			});
			return;
		}
		const summary = completion.result?.summary;
		const snapshotId = completion.result?.snapshotId;
		if (!summary || !isSafeSnapshotId(snapshotId) || summary.snapshot_id !== snapshotId) {
			await this.eventService.onBackupFailure({
				planId: reference.planId,
				backupId: reference.backupId,
				error: 'Remote agent completed without valid snapshot metadata.',
			});
			return;
		}
		const plan = await this.planStore.getById(reference.planId);
		const lifecycleReport = completion.result?.lifecycle;
		const configured = plan?.settings.remoteLifecycle
			? lifecycleDatabases(parseRemoteLifecycle(plan.settings.remoteLifecycle))
			: [];
		const reported = lifecycleReport?.databases;
		if (
			(lifecycleReport && !/^[a-f0-9]{64}$/.test(snapshotId)) ||
			(configured.length > 1 && !reported) ||
			(reported &&
				(reported.length !== configured.length ||
					configured.some(
						entry =>
							!reported.some(
								artifact =>
									artifact.databaseId === entry.databaseId &&
									artifact.engine === entry.engine &&
									artifact.database === entry.database &&
									artifact.path === `/pluton/database/${entry.dumpFilename}` &&
									artifact.bytes > 0 &&
									artifact.bytes <= entry.maxDumpBytes
							)
					)))
		) {
			await this.eventService.onBackupFailure({
				planId: reference.planId,
				backupId: reference.backupId,
				error:
					'Remote agent completed without valid database artifact metadata (snapshot-confirmation/snapshot-confirmation-failed).',
			});
			return;
		}
		await this.eventService.onBackupComplete({
			planId: reference.planId,
			backupId: reference.backupId,
			success: true,
			summary: {
				...summary,
				...(completion.result?.sourcePaths ? { sourcePaths: completion.result.sourcePaths } : {}),
				...(completion.result?.lifecycle ? { lifecycle: completion.result.lifecycle } : {}),
			},
		});
		if (completion.result?.lifecycle?.warnings.length) {
			await this.backupStore.update(reference.backupId, {
				errorMsg:
					'Snapshot completed; lifecycle cleanup needs attention: ' +
					completion.result.lifecycle.warnings
						.map(warning => `${warning.stage}/${warning.code}`)
						.join(', '),
			});
			serverLogger?.warn(
				{
					agentEvent: 'backup_lifecycle_warning',
					planId: reference.planId,
					backupId: reference.backupId,
					warnings: completion.result.lifecycle.warnings,
				},
				'Snapshot completed with lifecycle warnings'
			);
		}
		await this.repositories.markInitialized(reference.repositoryId);
		if (plan) {
			const snapshotIds = new Set([...(plan.stats?.snapshots || []), snapshotId]);
			await this.planStore.update(plan.id, {
				stats: {
					size: Math.max(plan.stats?.size || 0, summary.total_bytes_processed || 0),
					snapshots: [...snapshotIds],
				},
				lastBackupTime: new Date(),
			});
		}
		if (plan?.settings.replication?.enabled) {
			// The primary result stays independent from replica admission/execution.
			// Startup reconciliation also scans completed rows if this process exits here.
			void this.replicationService?.enqueueBackup(reference.backupId).catch(() => {
				serverLogger?.warn({ event: 'managed_replication_admission_interrupted', code: 'admission-interrupted' }, 'Replica admission needs reconciliation.');
			});
		}
	}

	async reconcileSchedules(): Promise<void> {
		const plans = (await this.planStore.getAll(false)) || [];
		const plansById = new Map(plans.map(plan => [plan.id, plan]));
		const schedules = await this.cronManager.getSchedules();
		for (const [planId, entries] of schedules) {
			if (!entries.some(entry => entry.type === 'remote-backup')) continue;
			const plan = plansById.get(planId);
			if (
				!plan ||
				!RemoteBackupService.isRemoteFilesystemPlan(plan) ||
				!(await this.repositories.getByPlanId(planId))
			) {
				await this.cronManager.removeSchedulesByType(planId, 'remote-backup');
			}
		}
		for (const plan of plans) {
			if (!RemoteBackupService.isRemoteFilesystemPlan(plan)) continue;
			if (!(await this.repositories.getByPlanId(plan.id))) continue;
			try {
				await this.ensureSchedule(plan);
			} catch {
				// Capability degradation is surfaced when the user runs the plan; startup must continue.
			}
		}
	}

	private async queueScheduledBackup(planId: string): Promise<void> {
		try {
			await this.queuePlanBackup(planId);
		} catch {
			// A later schedule run can retry; detailed source/provider diagnostics are not logged.
		}
	}

	private async ensureSchedule(plan: Plan): Promise<void> {
		const cronExpression = intervalToCron(plan.settings.interval);
		const options = {
			isActive: plan.isActive,
			taskCallback: async (planId: string) => this.queueScheduledBackup(planId),
		};
		const existing = await this.cronManager.getSchedule(plan.id);
		if (existing?.some(entry => entry.type === 'remote-backup')) {
			await this.cronManager.updateSchedule(plan.id, cronExpression, options, 'remote-backup');
		} else {
			await this.cronManager.scheduleTask(plan.id, cronExpression, options, 'remote-backup');
		}
	}

	private async assertSupportedPlan(
		plan: Plan | NewPlan,
		setPreparationStage?: SetPreparationStage,
		validateReplicaConfiguration = true
	): Promise<void> {
		setPreparationStage?.('plan-shape');
		if (!RemoteBackupService.isRemoteFilesystemPlan(plan) || plan.method !== 'backup') {
			throw new AppError(400, 'Only remote filesystem incremental backup is available.');
		}
		if (plan.settings.encryption !== true) {
			throw new AppError(
				400,
				'Remote filesystem backups require their managed repository password.'
			);
		}
		if (hasEnabledScripts(plan)) {
			throw new AppError(
				400,
				'Scripts are not available for remote filesystem backups.'
			);
		}
		if (plan.settings.replication?.enabled) {
			if (!this.replicationService) throw new AppError(503, 'Managed replication executor is not configured.');
			// Existing primary backups remain available when a mirror loses access.
			// Creation/settings changes still validate destination credentials and scope.
			if (validateReplicaConfiguration) await this.replicationService.validatePlan(plan);
		}
		if ((plan.settings.replication?.storages?.length || 0) > 2) {
			throw new AppError(400, 'Managed Agent plans support at most two replica destinations.');
		}
		setPreparationStage?.('source-validation');
		this.getSingleSource(plan.sourceConfig);
		this.getSafeExcludes(plan.sourceConfig);
		setPreparationStage?.('repository-path');
		validateRepositoryPath(plan.storagePath || '');
		setPreparationStage?.('agent-capability');
		await this.getCapableAgent(plan.sourceId);
		if (plan.settings.remoteLifecycle !== undefined) {
			setPreparationStage?.('lifecycle-configuration');
			const lifecycle = parseRemoteLifecycle(plan.settings.remoteLifecycle);
			const databases = lifecycleDatabases(lifecycle);
			if (databases.some(db => db.password !== undefined))
				throw new AppError(400, 'Database password cannot be stored in plan settings.');
			const agent = await this.getCapableAgent(plan.sourceId);
			const capabilities = agent.capabilities as {
				backupLifecycleVersion?: number;
				databaseEngines?: string[];
				hooksConfigured?: boolean;
			};
			if (
				![1, 2].includes(capabilities.backupLifecycleVersion || 0) ||
				(capabilities.backupLifecycleVersion === 1 &&
					(databases.length > 1 || databases.some(db => db.engine === 'postgresql'))) ||
				databases.some(db => !capabilities.databaseEngines?.includes(db.engine)) ||
				((lifecycle.preHook || lifecycle.postHook) && capabilities.hooksConfigured !== true)
			) {
				throw new AppError(
					409,
					'Remote agent does not support the selected database lifecycle or hooks. Update the agent and install the required dump client/hooks first.'
				);
			}
		}
		setPreparationStage?.('sftp-storage-lookup');
		const storage = await this.storageStore.getById(plan.storageId as string);
		if (!storage || storage.type !== 'sftp') {
			throw new AppError(400, 'Remote filesystem backups currently require an SFTP destination.');
		}
	}

	private async getCapableAgent(deviceId: string): Promise<AgentIdentity> {
		const agent = await this.agentStore.getAgentByDeviceId(deviceId);
		const offlineTimeoutMs = (configService.config.AGENT_OFFLINE_TIMEOUT_SECONDS || 90) * 1_000;
		if (
			!agent ||
			agent.revokedAt ||
			!agent.lastSeen ||
			Date.now() - agent.lastSeen.getTime() > offlineTimeoutMs
		) {
			throw new AppError(409, 'Remote agent is not available.');
		}
		const capabilities = agent.capabilities as {
			filesystemRootsConfigured?: unknown;
			commandTypes?: unknown;
		};
		const commands = Array.isArray(capabilities.commandTypes) ? capabilities.commandTypes : [];
		if (
			capabilities.filesystemRootsConfigured !== true ||
			!commands.includes('BACKUP_FILESYSTEM') ||
			!isNonEmptyString(agent.resticVersion) ||
			!isNonEmptyString(agent.rcloneVersion) ||
			!versionAtLeast(agent.agentVersion)
		) {
			throw new AppError(409, 'Remote agent does not yet support filesystem backup.');
		}
		return agent;
	}

	private getSingleSource(sourceConfig: PlanSource): string {
		if (!Array.isArray(sourceConfig?.includes) || sourceConfig.includes.length !== 1) {
			throw new AppError(400, 'Remote filesystem backup requires exactly one source path.');
		}
		const source = sourceConfig.includes[0]?.trim() || '';
		validateAbsoluteLinuxPath(source);
		return source;
	}

	private getSafeExcludes(sourceConfig: PlanSource): string[] {
		const excludes = sourceConfig?.excludes || [];
		if (!Array.isArray(excludes) || excludes.length > 100) {
			throw new AppError(400, 'Remote backup excludes are invalid.');
		}
		return excludes.map(exclude => {
			if (typeof exclude !== 'string') {
				throw new AppError(400, 'Remote backup exclude is invalid.');
			}
			const value = exclude.trim();
			if (!value || value.length > MAX_SOURCE_PATH_LENGTH || hasUnsafeControlCharacters(value)) {
				throw new AppError(400, 'Remote backup exclude is invalid.');
			}
			if (value.split(/[\\/]+/).includes('..')) {
				throw new AppError(400, 'Remote backup exclude cannot contain traversal.');
			}
			return value;
		});
	}

	private async materializeSftpStorage(
		storageId: string,
		setPreparationStage?: SetPreparationStage
	): Promise<{
		type: 'sftp';
		options: Record<string, string>;
	}> {
		setPreparationStage?.('sftp-storage-lookup');
		const storage = await this.storageStore.getById(storageId);
		if (!storage || storage.type !== 'sftp') {
			throw new AppError(400, 'Remote filesystem backups currently require an SFTP destination.');
		}
		const encrypted = storage.credentials || {};
		const decrypted: Record<string, string> = {};
		setPreparationStage?.('sftp-credential-decryption');
		try {
			const crypt = new Cryptr(this.encryptionSecret);
			for (const [key, value] of Object.entries(encrypted)) {
				if (!SFTP_AGENT_OPTION_KEYS.has(key) || typeof value !== 'string') {
					throw new Error('unsupported SFTP credential');
				}
				decrypted[key] = crypt.decrypt(value);
			}
		} catch {
			throw new AppError(500, 'Storage credentials could not be prepared for the remote agent.');
		}
		const settings = storage.settings || {};
		const options: Record<string, string> = {};
		setPreparationStage?.('sftp-setting-allowlist');
		for (const [key, value] of Object.entries(settings)) {
			if (!isMeaningfulStorageValue(value)) continue;
			if (!SFTP_AGENT_OPTION_KEYS.has(key) || key === 'pass') {
				setPreparationStage?.('sftp-setting-allowlist', {
					rejectedField: key,
					ruleCategory: 'unsupported-field',
				});
				throw new AppError(
					400,
					'Remote filesystem backups support only SFTP host, port, username, and encrypted password credentials.'
				);
			}
		}
		setPreparationStage?.('sftp-option-validation');
		for (const [key, value] of Object.entries({ ...settings, ...decrypted })) {
			// The Storage UI keeps disabled boolean options (and zero-valued
			// numeric defaults) in the JSON when a user toggles them. They mean
			// "unset" for rclone and must not be mistaken for an unsafe option.
			// Meaningful unsupported options were already rejected above, so this
			// does not widen the agent allowlist.
			if (!isMeaningfulStorageValue(value)) continue;
			if (!SFTP_AGENT_OPTION_KEYS.has(key)) {
				setPreparationStage?.('sftp-option-validation', {
					rejectedField: key,
					ruleCategory: 'unsupported-field',
				});
				throw new AppError(400, 'Remote filesystem backup SFTP configuration is unsupported.');
			}
			const normalized = String(value).replace(/\r?\n/g, '\\n');
			if (normalized.length > 16_384) {
				setPreparationStage?.('sftp-option-validation', {
					rejectedField: key,
					ruleCategory: 'value-too-long',
				});
				throw new AppError(400, 'SFTP configuration contains an unsafe value.');
			}
			if (hasUnsafeControlCharacters(normalized)) {
				setPreparationStage?.('sftp-option-validation', {
					rejectedField: key,
					ruleCategory: 'unsafe-control-character',
				});
				throw new AppError(400, 'SFTP configuration contains an unsafe value.');
			}
			options[key] = normalized;
		}
		setPreparationStage?.('sftp-required-credentials');
		if (!options.host || !options.user || !options.pass) {
			throw new AppError(
				400,
				'Remote filesystem backups require SFTP host, username, and password credentials.'
			);
		}
		return { type: 'sftp', options };
	}
}
