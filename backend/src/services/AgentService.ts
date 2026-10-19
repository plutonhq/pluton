import crypto from 'crypto';
import Cryptr from 'cryptr';
import { z } from 'zod';
import { remoteBackupFailure } from '../utils/remoteBackupDiagnostics';
import { remoteBackupStages } from '../utils/remoteBackupProgress';
import { type AgentCommand, type AgentIdentity } from '../db/schema/agents';
import { AgentStore } from '../stores/AgentStore';
import {
	AGENT_COMMAND_LEASE_MS,
	AGENT_COMMAND_TYPES,
	AGENT_REQUEST_SKEW_MS,
	type AgentInventory,
	type AuthenticatedAgent,
} from '../types/agents';
import { AppError, NotFoundError } from '../utils/AppError';
import { generateUID } from '../utils/helpers';
import { signAgentCommand, signAgentRequest, verifyAgentSignature } from '../utils/agentProtocol';
import { configService } from './ConfigService';
import { serverLogger } from '../utils/logger';
import type { RemoteBackupService } from './RemoteBackupService';
import { RemoteCommandPreparationError } from './remoteCommandPreparation';
import { databaseIdSchema } from '../utils/remoteLifecycle';

const inventorySchema = z
	.object({
		hostname: z.string().trim().min(1).max(255),
		os: z.string().trim().min(1).max(255),
		architecture: z.string().trim().min(1).max(128),
		agentVersion: z.string().trim().min(1).max(128),
		resticVersion: z.string().trim().min(1).max(128).optional(),
		rcloneVersion: z.string().trim().min(1).max(128).optional(),
		uptimeSeconds: z
			.number()
			.int()
			.nonnegative()
			.max(365 * 24 * 60 * 60)
			.optional(),
		capabilities: z
			.object({
				filesystemRootsConfigured: z.boolean(),
				commandTypes: z
					.array(z.enum(['PING', 'INVENTORY_REFRESH', 'BACKUP_FILESYSTEM']))
					.min(1)
					.max(3),
				backupLifecycleVersion: z.union([z.literal(1), z.literal(2)]).optional(),
				databaseEngines: z
					.array(z.enum(['mysql', 'mariadb', 'postgresql']))
					.max(3)
					.optional(),
				hooksConfigured: z.boolean().optional(),
			})
			.strict(),
	})
	.strict();

const enrollmentSchema = z
	.object({
		token: z.string().min(32).max(512),
		inventory: inventorySchema,
	})
	.strict();

const enrollmentNameSchema = z.object({ name: z.string().trim().min(1).max(100) }).strict();

// The agent may report only this closed set of non-secret execution metadata.
// Do not accept provider errors, command arguments, or arbitrary text here.
const backupFailureStageSchema = z.enum([
	'payload-validation',
	'source-validation',
	'state-validation',
	'tool-validation',
	'sftp-password-obscure',
	'temporary-storage-config',
	'repository-check',
	'repository-target-check',
	'repository-initialization',
	'restic-backup',
	'cleanup',
	'lifecycle-validation',
	'workspace-creation',
	'pre-backup',
	'database-dump',
	'database-dump-validation',
	'snapshot-confirmation',
	'post-backup',
]);
const backupFailureCodeSchema = z.enum([
	'invalid-payload',
	'source-validation-failed',
	'source-parent-not-traversable',
	'source-root-not-readable',
	'source-entry-inaccessible',
	'source-missing',
	'source-symlink-escape',
	'source-unsupported-type',
	'source-policy-violation',
	'state-overlap',
	'state-validation-failed',
	'tool-unavailable',
	'sftp-password-obscure-failed',
	'temporary-config-failed',
	'repository-check-failed',
	'repository-target-check-failed',
	'repository-target-not-empty',
	'target-check-access-failed',
	'target-check-auth-failed',
	'target-check-transport-failed',
	'repository-initialization-failed',
	'restic-backup-failed',
	'restic-summary-missing',
	'cleanup-failed',
	'cancelled',
	'unexpected',
	'lifecycle-invalid',
	'workspace-failed',
	'database-tool-unavailable',
	'database-client-missing',
	'database-client-incompatible',
	'database-tls-verification-failed',
	'database-output-empty',
	'database-auth-failed',
	'database-insufficient-privileges',
	'database-unavailable',
	'database-invalid-configuration',
	'database-dump-failed',
	'database-dump-timeout',
	'database-dump-output-limit',
	'database-dump-invalid',
	'hook-invalid',
	'hook-failed',
	'hook-timeout',
	'hook-output-limit',
	'snapshot-confirmation-failed',
]);
const lifecycleStageSchema = z.enum([
	'pre-backup-started',
	'database-dump-started',
	'database-dump-completed',
	'backup-started',
	'backup-completed',
	'post-backup-started',
	'cleanup-completed',
	'cleanup-warning',
]);
const lifecycleReportSchema = z
	.object({
		warnings: z
			.array(
				z
					.object({
						stage: z.enum(['post-backup', 'cleanup']),
						code: z.enum([
							'hook-invalid',
							'hook-failed',
							'hook-timeout',
							'hook-output-limit',
							'cleanup-failed',
						]),
					})
					.strict()
			)
			.max(3),
		database: z
			.object({
				path: z.string().regex(/^\/pluton\/database\/[A-Za-z0-9_][A-Za-z0-9_.-]{0,95}\.sql$/),
				bytes: z
					.number()
					.int()
					.positive()
					.max(100 * 1024 ** 3),
				sha256: z.string().regex(/^[a-f0-9]{64}$/),
			})
			.strict()
			.optional(),
		databases: z
			.array(
				z
					.object({
						databaseId: databaseIdSchema,
						engine: z.enum(['mysql', 'mariadb', 'postgresql']),
						database: z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/),
						path: z.string().regex(/^\/pluton\/database\/[A-Za-z0-9_][A-Za-z0-9_.-]{0,95}\.sql$/),
						bytes: z
							.number()
							.int()
							.positive()
							.max(100 * 1024 ** 3),
						sha256: z.string().regex(/^[a-f0-9]{64}$/),
					})
					.strict()
			)
			.max(8)
			.refine(
				entries =>
					new Set(entries.map(entry => entry.databaseId)).size === entries.length &&
					new Set(entries.map(entry => entry.path.toLowerCase())).size === entries.length
			)
			.optional(),
	})
	.strict();

function safeCommandReference(value: unknown): string | undefined {
	return typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value) ? value : undefined;
}

export type AgentPublic = {
	agentId: string;
	deviceId: string;
	status: 'online' | 'offline' | 'revoked';
	hostname: string;
	os: string;
	architecture: string;
	agentVersion: string;
	resticVersion: string | null;
	rcloneVersion: string | null;
	capabilities: Record<string, unknown>;
	lastSeen: Date | null;
	createdAt: Date;
};

/**
 * Service for the deliberately small, outbound-only Phase 4 agent control
 * plane. It does not run Restic, Rclone, shell commands, restores, or scripts.
 */
export class AgentService {
	constructor(
		private readonly agentStore: AgentStore,
		private readonly encryptionSecret = configService.config.SECRET,
		private readonly now: () => Date = () => new Date(),
		private readonly remoteBackupService?: RemoteBackupService
	) {}

	async createEnrollment(input: unknown): Promise<{
		id: string;
		token: string;
		expiresAt: Date;
		deviceName: string;
		serverUrl: string;
		insecureHttpAllowed: boolean;
	}> {
		const parsed = enrollmentNameSchema.safeParse(input);
		if (!parsed.success) throw new AppError(400, 'A remote machine name is required.');

		const token = crypto.randomBytes(32).toString('base64url');
		const expiresAt = new Date(this.now().getTime() + 15 * 60 * 1000);
		const created = await this.agentStore.createEnrollment({
			id: generateUID(24),
			tokenHash: this.hashToken(token),
			deviceName: parsed.data.name,
			expiresAt,
		});
		if (!created) throw new AppError(500, 'Could not create an enrollment token.');
		this.audit('enrollment_token_created');
		return {
			id: created.id,
			token,
			expiresAt,
			deviceName: created.deviceName,
			serverUrl: configService.config.AGENT_SERVER_URL || configService.config.APP_URL,
			insecureHttpAllowed: configService.config.ALLOW_INSECURE_AGENT_HTTP === true,
		};
	}

	async revokeEnrollment(id: string): Promise<void> {
		const revoked = await this.agentStore.revokeEnrollment(id);
		if (!revoked) throw new NotFoundError('Enrollment token was not found or is already used.');
		this.audit('enrollment_token_revoked');
	}

	async enroll(input: unknown): Promise<{
		deviceId: string;
		agentId: string;
		secret: string;
		pollIntervalSeconds: number;
	}> {
		const parsed = enrollmentSchema.safeParse(input);
		if (!parsed.success) throw new AppError(400, 'Enrollment request is invalid.');

		const deviceId = `remote-${generateUID(20)}`;
		const agentId = `agent-${crypto.randomBytes(18).toString('base64url')}`;
		const secret = crypto.randomBytes(32).toString('base64url');
		const encryptedSecret = new Cryptr(this.encryptionSecret).encrypt(secret);

		let enrollment;
		try {
			enrollment = await this.agentStore.enrollAgent({
				tokenHash: this.hashToken(parsed.data.token),
				now: this.now(),
				device: {
					id: deviceId,
					agentId,
					inventory: parsed.data.inventory,
				},
				identity: {
					agentId,
					deviceId,
					encryptedSecret,
					inventory: parsed.data.inventory,
				},
				command: {
					id: generateUID(24),
					agentId,
					type: 'INVENTORY_REFRESH',
					payload: {},
					idempotencyKey: crypto.randomUUID(),
				},
			});
		} catch {
			// The transaction rolls back its token claim, identity, and device together.
			this.audit('enrollment_failed');
			throw new AppError(500, 'Enrollment could not be completed. Create a new enrollment token.');
		}
		if (!enrollment) {
			this.audit('enrollment_rejected');
			throw new AppError(401, 'Enrollment token is invalid, expired, revoked, or already used.');
		}

		this.audit('agent_enrolled');
		return { deviceId, agentId, secret, pollIntervalSeconds: 15 };
	}

	async authenticate(input: {
		agentId?: string;
		timestamp?: string;
		nonce?: string;
		signature?: string;
		method: string;
		path: string;
		body: string;
	}): Promise<AuthenticatedAgent> {
		if (!input.agentId || !input.timestamp || !input.nonce || !input.signature) {
			return this.authenticationFailure();
		}
		if (!/^[A-Za-z0-9_-]{22,128}$/.test(input.nonce)) {
			return this.authenticationFailure();
		}
		const timestamp = Number(input.timestamp);
		if (
			!Number.isSafeInteger(timestamp) ||
			Math.abs(this.now().getTime() - timestamp) > AGENT_REQUEST_SKEW_MS
		) {
			return this.authenticationFailure();
		}

		const identity = await this.agentStore.getAgentById(input.agentId);
		if (!identity || identity.revokedAt) {
			return this.authenticationFailure();
		}
		let secret: string;
		try {
			secret = new Cryptr(this.encryptionSecret).decrypt(identity.encryptedSecret);
		} catch {
			return this.authenticationFailure();
		}
		const expected = signAgentRequest(
			secret,
			input.timestamp,
			input.nonce,
			input.method,
			input.path,
			input.body
		);
		if (!verifyAgentSignature(expected, input.signature)) {
			return this.authenticationFailure();
		}
		const nonceHash = crypto.createHash('sha256').update(input.nonce).digest('base64url');
		const reserved = await this.agentStore.reserveNonce(
			identity.agentId,
			nonceHash,
			new Date(timestamp + AGENT_REQUEST_SKEW_MS)
		);
		if (!reserved) {
			this.audit('replay_rejected');
			return this.authenticationFailure(false);
		}
		return { agentId: identity.agentId, deviceId: identity.deviceId, secret };
	}

	assertTransportIsAllowed(isSecure: boolean): void {
		if (!isSecure && configService.config.ALLOW_INSECURE_AGENT_HTTP !== true) {
			throw new AppError(403, 'Agent HTTPS is required by this server.');
		}
	}

	async heartbeat(agentId: string, input: unknown): Promise<AgentPublic> {
		const inventory = this.parseInventory(input);
		const updated = await this.agentStore.updateHeartbeat(agentId, inventory);
		if (!updated) throw new AppError(401, 'Agent authentication failed.');
		return this.toPublic(updated);
	}

	async poll(agent: AuthenticatedAgent): Promise<{
		command:
			| (Pick<AgentCommand, 'id' | 'type' | 'payload' | 'idempotencyKey' | 'leaseExpiresAt'> & {
					leaseToken: string;
					signature: string;
					signatureTimestamp: string;
			  })
			| null;
	}> {
		const leaseToken = crypto.randomBytes(24).toString('base64url');
		const command = await this.agentStore.leaseNext(
			agent.agentId,
			leaseToken,
			AGENT_COMMAND_LEASE_MS,
			this.now()
		);
		if (!command) return { command: null };
		let payload = command.payload;
		if (command.type === 'BACKUP_FILESYSTEM') {
			try {
				if (!this.remoteBackupService) {
					throw new RemoteCommandPreparationError({ stage: 'materializer-unavailable' });
				}
				payload = await this.remoteBackupService.materializeCommand(agent.agentId, command);
			} catch (error) {
				// Do not lease a command whose ephemeral credentials or managed plan can no
				// longer be prepared. Mark it terminal without disclosing provider details.
				this.logRemoteBackupPreparationFailure(agent, error);
				const failed = await this.agentStore.completeCommand(
					agent.agentId,
					command.id,
					leaseToken,
					command.lastEventSequence + 1,
					false,
					'Remote backup command could not be prepared.',
					this.now()
				);
				if (failed) {
					await this.remoteBackupService?.completeCommand(failed, {
						success: false,
						error: 'Remote backup command could not be prepared.',
					});
				}
				return { command: null };
			}
		}
		const signatureTimestamp = this.now().getTime().toString();
		const signedCommand = { ...command, payload };
		this.audit('command_leased');
		return {
			command: {
				id: command.id,
				type: command.type,
				payload,
				idempotencyKey: command.idempotencyKey,
				leaseExpiresAt: command.leaseExpiresAt,
				leaseToken,
				signatureTimestamp,
				signature: signAgentCommand(agent.secret, signatureTimestamp, signedCommand, leaseToken),
			},
		};
	}

	async acknowledge(agentId: string, commandId: string, input: unknown): Promise<void> {
		const parsed = this.parseLeaseToken(input);
		const command = await this.agentStore.acknowledgeCommand(
			agentId,
			commandId,
			parsed.leaseToken,
			this.now()
		);
		if (!command) throw new NotFoundError('Command not found.');
	}

	async recordEvent(agentId: string, commandId: string, input: unknown): Promise<void> {
		const parsed = z
			.object({
				sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
				leaseToken: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
				event: z
					.object({
						phase: z.enum(['accepted', 'running']).optional(),
						backupStage: z.enum(remoteBackupStages).optional(),
						lifecycleStage: lifecycleStageSchema.optional(),
						databaseId: databaseIdSchema.optional(),
						engine: z.enum(['mysql', 'mariadb', 'postgresql']).optional(),
						ordinal: z.number().int().min(1).max(8).optional(),
						count: z.number().int().min(1).max(8).optional(),
						progress: z
							.object({
								bytesProcessed: z
									.number()
									.finite()
									.nonnegative()
									.max(Number.MAX_SAFE_INTEGER)
									.optional(),
								filesProcessed: z
									.number()
									.finite()
									.nonnegative()
									.max(Number.MAX_SAFE_INTEGER)
									.optional(),
								totalBytesProcessed: z
									.number()
									.finite()
									.nonnegative()
									.max(Number.MAX_SAFE_INTEGER)
									.optional(),
								totalFilesProcessed: z
									.number()
									.finite()
									.nonnegative()
									.max(Number.MAX_SAFE_INTEGER)
									.optional(),
							})
							.strict()
							.optional(),
					})
					.strict()
					.optional(),
			})
			.strict()
			.safeParse(input);
		if (!parsed.success) throw new AppError(400, 'Command event is invalid.');
		const command = await this.agentStore.recordCommandEvent(
			agentId,
			commandId,
			parsed.data.leaseToken,
			parsed.data.sequence,
			this.now(),
			AGENT_COMMAND_LEASE_MS
		);
		if (!command) throw new NotFoundError('Command not found.');
		if (
			parsed.data.event &&
			command.state === 'running' &&
			command.lastEventSequence === parsed.data.sequence
		)
			await this.remoteBackupService?.recordCommandEvent(
				command,
				parsed.data.event,
				parsed.data.sequence
			);
	}

	async complete(agentId: string, commandId: string, input: unknown): Promise<void> {
		const parsed = z
			.object({
				sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
				leaseToken: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
				success: z.boolean(),
				error: z.string().trim().min(1).max(500).optional(),
				failureStage: backupFailureStageSchema.optional(),
				failureCode: backupFailureCodeSchema.optional(),
				databaseId: databaseIdSchema.optional(),
				engine: z.enum(['mysql', 'mariadb', 'postgresql']).optional(),
				cancelled: z.boolean().optional(),
				result: z
					.object({
						snapshotId: z
							.string()
							.trim()
							.regex(/^[A-Fa-f0-9]{8,128}$/),
						sourcePaths: z
							.array(
								z
									.string()
									.max(4096)
									.refine(
										value =>
											value.startsWith('/') &&
											![...value].some(
												character =>
													character.charCodeAt(0) <= 0x1f || character.charCodeAt(0) === 0x7f
											) &&
											!value.split(/[\\/]+/).includes('..')
									)
							)
							.length(1)
							.optional(),
						summary: z
							.object({
								message_type: z.literal('summary'),
								files_new: z.number().finite().nonnegative(),
								files_changed: z.number().finite().nonnegative(),
								files_unmodified: z.number().finite().nonnegative(),
								dirs_new: z.number().finite().nonnegative(),
								dirs_changed: z.number().finite().nonnegative(),
								dirs_unmodified: z.number().finite().nonnegative(),
								data_blobs: z.number().finite().nonnegative(),
								tree_blobs: z.number().finite().nonnegative(),
								data_added: z.number().finite().nonnegative(),
								data_added_packed: z.number().finite().nonnegative(),
								total_files_processed: z.number().finite().nonnegative(),
								total_bytes_processed: z.number().finite().nonnegative(),
								total_duration: z.number().finite().nonnegative(),
								snapshot_id: z
									.string()
									.trim()
									.regex(/^[A-Fa-f0-9]{8,128}$/),
							})
							.strict(),
						lifecycle: lifecycleReportSchema.optional(),
					})
					.strict()
					.optional(),
			})
			.strict()
			.safeParse(input);
		if (!parsed.success || (!parsed.data.success && !parsed.data.error)) {
			throw new AppError(400, 'Command completion is invalid.');
		}
		// Phase 5 diagnostics use closed codes, not agent-supplied provider text.
		const safeError = parsed.data.success ? undefined : remoteBackupFailure(parsed.data);
		const command = await this.agentStore.completeCommand(
			agentId,
			commandId,
			parsed.data.leaseToken,
			parsed.data.sequence,
			parsed.data.success,
			safeError,
			this.now()
		);
		if (!command) throw new NotFoundError('Command not found.');
		if (command.state === 'completed' && !parsed.data.success) return;
		if (!parsed.data.success && command.type === 'BACKUP_FILESYSTEM' && serverLogger) {
			const payload = command.payload as Record<string, unknown>;
			serverLogger.warn(
				{
					agentEvent: 'command_failed',
					agentId,
					commandId: command.id,
					...(safeCommandReference(payload.planId) ? { planId: payload.planId } : {}),
					...(safeCommandReference(payload.backupId) ? { backupId: payload.backupId } : {}),
					failureStage: parsed.data.failureStage,
					failureCode: parsed.data.failureCode,
					...(parsed.data.databaseId
						? { databaseId: parsed.data.databaseId, engine: parsed.data.engine }
						: {}),
				},
				'BACKUP_FILESYSTEM command failed'
			);
		}
		await this.remoteBackupService?.completeCommand(command, {
			success: parsed.data.success,
			cancelled: parsed.data.cancelled,
			error: safeError,
			failureStage: parsed.data.failureStage,
			failureCode: parsed.data.failureCode,
			...(parsed.data.databaseId
				? { databaseId: parsed.data.databaseId, engine: parsed.data.engine }
				: {}),
			result: parsed.data.result,
		});
		this.audit(command.state === 'completed' ? 'command_completed' : 'command_failed');
	}

	async commandStatus(
		agentId: string,
		commandId: string,
		input: unknown
	): Promise<{ cancelled: boolean }> {
		const parsed = this.parseLeaseToken(input);
		const status = await this.agentStore.getCommandStatus(
			agentId,
			commandId,
			parsed.leaseToken,
			AGENT_COMMAND_LEASE_MS,
			this.now()
		);
		if (!status) throw new NotFoundError('Command not found.');
		return { cancelled: status.cancelled };
	}

	async revokeDevice(deviceId: string): Promise<void> {
		const revoked = await this.agentStore.revokeAgentByDeviceId(deviceId);
		if (!revoked) throw new NotFoundError('Remote machine was not found or is already revoked.');
		this.audit('agent_revoked');
	}

	async getPublicAgent(deviceId: string): Promise<AgentPublic | null> {
		const identity = await this.agentStore.getAgentByDeviceId(deviceId);
		return identity ? this.toPublic(identity) : null;
	}

	private parseInventory(input: unknown): AgentInventory {
		const parsed = inventorySchema.safeParse(input);
		if (!parsed.success) throw new AppError(400, 'Agent inventory is invalid.');
		return parsed.data;
	}

	private toPublic(identity: AgentIdentity): AgentPublic {
		const timeout = (configService.config.AGENT_OFFLINE_TIMEOUT_SECONDS || 90) * 1000;
		const status = identity.revokedAt
			? 'revoked'
			: identity.lastSeen && this.now().getTime() - identity.lastSeen.getTime() <= timeout
				? 'online'
				: 'offline';
		return {
			agentId: identity.agentId,
			deviceId: identity.deviceId,
			status,
			hostname: identity.hostname,
			os: identity.os,
			architecture: identity.architecture,
			agentVersion: identity.agentVersion,
			resticVersion: identity.resticVersion,
			rcloneVersion: identity.rcloneVersion,
			capabilities: identity.capabilities,
			lastSeen: identity.lastSeen,
			createdAt: identity.createdAt,
		};
	}

	private hashToken(token: string): string {
		return crypto.createHash('sha256').update(token).digest('base64url');
	}

	private parseLeaseToken(input: unknown): { leaseToken: string } {
		const parsed = z
			.object({ leaseToken: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/) })
			.strict()
			.safeParse(input);
		if (!parsed.success) throw new AppError(400, 'Command acknowledgement is invalid.');
		return parsed.data;
	}

	private authenticationFailure(audit = true): never {
		if (audit) this.audit('authentication_rejected');
		throw new AppError(401, 'Agent authentication failed.');
	}

	private logRemoteBackupPreparationFailure(agent: AuthenticatedAgent, error: unknown): void {
		const failure =
			error instanceof RemoteCommandPreparationError
				? error
				: new RemoteCommandPreparationError({ stage: 'unexpected' });
		// Never log the caught error: provider/decryption errors can carry storage
		// credentials or other secret material. The optional field/rule metadata is
		// produced from a closed, sanitized allowlist and contains no value.
		if (serverLogger) {
			serverLogger.warn(
				{
					agentEvent: 'remote_backup_command_preparation_failed',
					deviceId: agent.deviceId,
					failureStage: failure.stage,
					failureMessage: failure.safeMessage,
					...(failure.planId ? { planId: failure.planId } : {}),
					...(failure.backupId ? { backupId: failure.backupId } : {}),
					...(failure.storageId ? { storageId: failure.storageId } : {}),
					...(failure.rejectedField ? { rejectedField: failure.rejectedField } : {}),
					...(failure.ruleCategory ? { ruleCategory: failure.ruleCategory } : {}),
				},
				'Remote backup command preparation failed'
			);
		}
	}

	private audit(event: string): void {
		// Logger initialization is part of createApp; unit tests deliberately use
		// the service without process-wide logging.
		if (serverLogger) {
			serverLogger.info({ agentEvent: event }, 'Agent control-plane event');
		}
	}
}

export { inventorySchema, AGENT_COMMAND_TYPES };
