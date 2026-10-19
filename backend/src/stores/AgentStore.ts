import { and, asc, eq, gt, inArray, isNull, lt, lte } from 'drizzle-orm';
import { DatabaseType } from '../db';
import { devices } from '../db/schema/devices';
import {
	agentCommands,
	agentEnrollmentTokens,
	agentIdentities,
	agentRequestNonces,
	type AgentCommand,
	type AgentEnrollmentToken,
	type AgentIdentity,
} from '../db/schema/agents';
import { AGENT_COMMAND_TYPES, type AgentInventory } from '../types/agents';

type NewAgentIdentity = {
	agentId: string;
	deviceId: string;
	encryptedSecret: string;
	inventory: AgentInventory;
};

type EnrollAgentData = {
	tokenHash: string;
	now: Date;
	device: {
		id: string;
		agentId: string;
		inventory: AgentInventory;
	};
	identity: NewAgentIdentity;
	command: {
		id: string;
		agentId: string;
		type: AgentCommand['type'];
		payload: Record<string, unknown>;
		idempotencyKey: string;
	};
};

/** Persistence boundary for the agent control plane. */
export class AgentStore {
	constructor(private readonly db: DatabaseType) {}

	async createEnrollment(data: {
		id: string;
		tokenHash: string;
		deviceName: string;
		expiresAt: Date;
	}): Promise<AgentEnrollmentToken | null> {
		const created = await this.db.insert(agentEnrollmentTokens).values(data).returning();
		return created[0] || null;
	}

	async revokeEnrollment(id: string): Promise<AgentEnrollmentToken | null> {
		const updated = await this.db
			.update(agentEnrollmentTokens)
			.set({ revokedAt: new Date() })
			.where(
				and(
					eq(agentEnrollmentTokens.id, id),
					isNull(agentEnrollmentTokens.usedAt),
					isNull(agentEnrollmentTokens.revokedAt)
				)
			)
			.returning();
		return updated[0] || null;
	}

	/**
	 * Consumes the one-time credential and creates the device, identity, and
	 * initial safe command in one SQLite transaction. A failed enrollment never
	 * leaves a partially created remote device or a spent token behind.
	 */
	async enrollAgent(data: EnrollAgentData): Promise<AgentEnrollmentToken | null> {
		if (!AGENT_COMMAND_TYPES.includes(data.command.type)) {
			throw new Error('REMOTE_CAPABILITY_NOT_IMPLEMENTED');
		}
		if (
			data.device.id !== data.identity.deviceId ||
			data.device.agentId !== data.identity.agentId ||
			data.command.agentId !== data.identity.agentId
		) {
			throw new Error('Agent enrollment data is inconsistent.');
		}

		return this.db.transaction(tx => {
			const enrollment = tx
				.update(agentEnrollmentTokens)
				.set({ usedAt: data.now })
				.where(
					and(
						eq(agentEnrollmentTokens.tokenHash, data.tokenHash),
						isNull(agentEnrollmentTokens.usedAt),
						isNull(agentEnrollmentTokens.revokedAt),
						gt(agentEnrollmentTokens.expiresAt, data.now)
					)
				)
				.returning()
				.get();
			if (!enrollment) return null;

			// Reject a duplicate enrollment before any new device row is written.
			// This stays in the same transaction as the token claim, so throwing
			// also rolls the claim back. The database primary key remains the
			// race-safe final guard.
			const existingDevice = tx
				.select({ id: devices.id })
				.from(devices)
				.where(eq(devices.id, data.device.id))
				.get();
			if (existingDevice) {
				throw new Error('Device is already enrolled.');
			}

			tx.insert(devices)
				.values({
					id: data.device.id,
					name: enrollment.deviceName,
					type: 'remote-agent',
					agentId: data.device.agentId,
					hostname: data.device.inventory.hostname,
					os: data.device.inventory.os,
					platform: data.device.inventory.architecture,
					versions: {
						agent: data.device.inventory.agentVersion,
						restic: data.device.inventory.resticVersion || '',
						rclone: data.device.inventory.rcloneVersion || '',
					},
					status: 'active',
					lastSeen: data.now,
					tags: [],
				})
				.run();

			const identity = tx
				.insert(agentIdentities)
				.values({
					agentId: data.identity.agentId,
					deviceId: data.identity.deviceId,
					encryptedSecret: data.identity.encryptedSecret,
					hostname: data.identity.inventory.hostname,
					os: data.identity.inventory.os,
					architecture: data.identity.inventory.architecture,
					agentVersion: data.identity.inventory.agentVersion,
					resticVersion: data.identity.inventory.resticVersion || null,
					rcloneVersion: data.identity.inventory.rcloneVersion || null,
					capabilities: data.identity.inventory.capabilities,
					lastSeen: data.now,
				})
				.returning()
				.get();
			if (!identity) throw new Error('Could not save agent identity.');

			tx.insert(agentCommands).values(data.command).run();
			return enrollment;
		});
	}

	async getAgentById(agentId: string): Promise<AgentIdentity | null> {
		return (
			(await this.db.query.agentIdentities.findFirst({
				where: eq(agentIdentities.agentId, agentId),
			})) || null
		);
	}

	async getAgentByDeviceId(deviceId: string): Promise<AgentIdentity | null> {
		return (
			(await this.db.query.agentIdentities.findFirst({
				where: eq(agentIdentities.deviceId, deviceId),
			})) || null
		);
	}

	async updateHeartbeat(agentId: string, inventory: AgentInventory): Promise<AgentIdentity | null> {
		const now = new Date();
		const updated = await this.db
			.update(agentIdentities)
			.set({
				hostname: inventory.hostname,
				os: inventory.os,
				architecture: inventory.architecture,
				agentVersion: inventory.agentVersion,
				resticVersion: inventory.resticVersion || null,
				rcloneVersion: inventory.rcloneVersion || null,
				capabilities: inventory.capabilities,
				lastSeen: now,
			})
			.where(and(eq(agentIdentities.agentId, agentId), isNull(agentIdentities.revokedAt)))
			.returning();
		const agent = updated[0] || null;
		if (!agent) return null;

		await this.db
			.update(devices)
			.set({
				hostname: inventory.hostname,
				os: inventory.os,
				platform: inventory.architecture,
				versions: {
					agent: inventory.agentVersion,
					restic: inventory.resticVersion || '',
					rclone: inventory.rcloneVersion || '',
				},
				status: 'active',
				lastSeen: now,
			})
			.where(eq(devices.id, agent.deviceId));

		return agent;
	}

	async revokeAgentByDeviceId(deviceId: string): Promise<AgentIdentity | null> {
		const now = new Date();
		const updated = await this.db
			.update(agentIdentities)
			.set({ revokedAt: now })
			.where(and(eq(agentIdentities.deviceId, deviceId), isNull(agentIdentities.revokedAt)))
			.returning();
		const agent = updated[0] || null;
		if (agent) {
			await this.db
				.update(devices)
				.set({ status: 'revoked', lastSeen: agent.lastSeen })
				.where(eq(devices.id, deviceId));
		}
		return agent;
	}

	async reserveNonce(agentId: string, nonceHash: string, expiresAt: Date): Promise<boolean> {
		await this.db.delete(agentRequestNonces).where(lt(agentRequestNonces.expiresAt, new Date()));
		try {
			await this.db.insert(agentRequestNonces).values({
				id: `${agentId}:${nonceHash}`,
				agentId,
				nonceHash,
				expiresAt,
			});
			return true;
		} catch {
			return false;
		}
	}

	async enqueueCommand(data: {
		id: string;
		agentId: string;
		type: AgentCommand['type'];
		payload: Record<string, unknown>;
		idempotencyKey: string;
	}): Promise<AgentCommand | null> {
		if (!AGENT_COMMAND_TYPES.includes(data.type)) {
			throw new Error('REMOTE_CAPABILITY_NOT_IMPLEMENTED');
		}
		const created = await this.db.insert(agentCommands).values(data).returning();
		return created[0] || null;
	}

	/**
	 * Returns at most one command. Expired leases are made available again before
	 * leasing, so a server restart cannot silently discard work.
	 */
	async leaseNext(
		agentId: string,
		leaseOwner: string,
		leaseMs: number,
		now = new Date()
	): Promise<AgentCommand | null> {
		await this.db
			.update(agentCommands)
			.set({ state: 'queued', leaseOwner: null, leaseExpiresAt: null, leasedAt: null })
			.where(
				and(
					eq(agentCommands.agentId, agentId),
					inArray(agentCommands.state, ['leased', 'acknowledged', 'running']),
					lte(agentCommands.leaseExpiresAt, now)
				)
			);

		// One agent service is deliberately a serial executor in this MVP. This
		// durable gate also protects against duplicate polls from a restarted or
		// accidentally duplicated service process: a second queued command cannot
		// be leased while a non-expired command is active for the same agent.
		const activeCommand = await this.db.query.agentCommands.findFirst({
			where: and(
				eq(agentCommands.agentId, agentId),
				inArray(agentCommands.state, ['leased', 'acknowledged', 'running']),
				gt(agentCommands.leaseExpiresAt, now)
			),
		});
		if (activeCommand) return null;

		const candidate = await this.db.query.agentCommands.findFirst({
			where: and(eq(agentCommands.agentId, agentId), eq(agentCommands.state, 'queued')),
			orderBy: asc(agentCommands.createdAt),
		});
		if (!candidate) return null;

		const leaseExpiresAt = new Date(now.getTime() + leaseMs);
		const leased = await this.db
			.update(agentCommands)
			.set({
				state: 'leased',
				leaseOwner,
				leasedAt: now,
				leaseExpiresAt,
				attemptCount: candidate.attemptCount + 1,
			})
			.where(and(eq(agentCommands.id, candidate.id), eq(agentCommands.state, 'queued')))
			.returning();
		return leased[0] || null;
	}

	async acknowledgeCommand(
		agentId: string,
		commandId: string,
		leaseToken: string,
		now = new Date()
	): Promise<AgentCommand | null> {
		const existing = await this.getCommandForAgent(agentId, commandId);
		if (!existing) return null;
		if (existing.state === 'completed' || existing.state === 'failed') return existing;
		if (
			existing.leaseOwner !== leaseToken ||
			!existing.leaseExpiresAt ||
			existing.leaseExpiresAt <= now
		) {
			return null;
		}
		const acknowledged = await this.db
			.update(agentCommands)
			.set({ state: 'acknowledged', acknowledgedAt: new Date() })
			.where(
				and(
					eq(agentCommands.id, commandId),
					eq(agentCommands.agentId, agentId),
					eq(agentCommands.leaseOwner, leaseToken),
					gt(agentCommands.leaseExpiresAt, now),
					inArray(agentCommands.state, ['leased', 'acknowledged'])
				)
			)
			.returning();
		return acknowledged[0] || null;
	}

	async recordCommandEvent(
		agentId: string,
		commandId: string,
		leaseToken: string,
		sequence: number,
		now = new Date(),
		leaseMs = 60_000
	): Promise<AgentCommand | null> {
		const existing = await this.getCommandForAgent(agentId, commandId);
		if (!existing) return null;
		if (
			existing.state === 'completed' ||
			existing.state === 'failed' ||
			existing.state === 'cancelled'
		) {
			return existing;
		}
		if (
			existing.leaseOwner !== leaseToken ||
			!existing.leaseExpiresAt ||
			existing.leaseExpiresAt <= now
		) {
			return null;
		}
		if (sequence <= existing.lastEventSequence) return existing;

		const updated = await this.db
			.update(agentCommands)
			.set({
				state: 'running',
				lastEventSequence: sequence,
				// A long Restic run keeps its durable lease while it sends bounded progress.
				leaseExpiresAt: new Date(now.getTime() + leaseMs),
			})
			.where(
				and(
					eq(agentCommands.id, commandId),
					eq(agentCommands.agentId, agentId),
					eq(agentCommands.leaseOwner, leaseToken),
					gt(agentCommands.leaseExpiresAt, now),
					inArray(agentCommands.state, ['leased', 'acknowledged', 'running']),
					lt(agentCommands.lastEventSequence, sequence)
				)
			)
			.returning();
		return updated[0] || null;
	}

	async completeCommand(
		agentId: string,
		commandId: string,
		leaseToken: string,
		sequence: number,
		success: boolean,
		error?: string,
		now = new Date()
	): Promise<AgentCommand | null> {
		const existing = await this.getCommandForAgent(agentId, commandId);
		if (!existing) return null;
		if (
			existing.state === 'completed' ||
			existing.state === 'failed' ||
			existing.state === 'cancelled'
		) {
			return existing;
		}
		if (
			existing.leaseOwner !== leaseToken ||
			!existing.leaseExpiresAt ||
			existing.leaseExpiresAt <= now
		) {
			return null;
		}
		if (sequence <= existing.lastEventSequence) return null;

		const completed = await this.db
			.update(agentCommands)
			.set({
				state: success ? 'completed' : 'failed',
				completedAt: new Date(),
				lastEventSequence: sequence,
				lastError: success ? null : error || 'Agent reported command failure.',
			})
			.where(
				and(
					eq(agentCommands.id, commandId),
					eq(agentCommands.agentId, agentId),
					eq(agentCommands.leaseOwner, leaseToken),
					gt(agentCommands.leaseExpiresAt, now),
					inArray(agentCommands.state, ['leased', 'acknowledged', 'running']),
					lt(agentCommands.lastEventSequence, sequence)
				)
			)
			.returning();
		return completed[0] || null;
	}

	async getCommandForAgent(agentId: string, commandId: string): Promise<AgentCommand | null> {
		return (
			(await this.db.query.agentCommands.findFirst({
				where: and(eq(agentCommands.id, commandId), eq(agentCommands.agentId, agentId)),
			})) || null
		);
	}

	/**
	 * Marks a durable command cancelled without deleting its audit trail. A
	 * running agent observes this through its signed status poll and terminates
	 * the Restic process group itself.
	 */
	async cancelCommand(commandId: string): Promise<AgentCommand | null> {
		const existing = await this.db.query.agentCommands.findFirst({
			where: eq(agentCommands.id, commandId),
		});
		if (!existing) return null;
		if (['completed', 'failed', 'cancelled'].includes(existing.state)) return existing;
		const updated = await this.db
			.update(agentCommands)
			.set({ state: 'cancelled', completedAt: new Date(), lastError: 'Cancelled by user.' })
			.where(
				and(
					eq(agentCommands.id, commandId),
					inArray(agentCommands.state, ['queued', 'leased', 'acknowledged', 'running'])
				)
			)
			.returning();
		return updated[0] || existing;
	}

	/** Refreshes an active lease and tells the agent whether a user cancelled it. */
	async getCommandStatus(
		agentId: string,
		commandId: string,
		leaseToken: string,
		leaseMs: number,
		now = new Date()
	): Promise<{ command: AgentCommand; cancelled: boolean } | null> {
		const existing = await this.getCommandForAgent(agentId, commandId);
		if (!existing || existing.leaseOwner !== leaseToken) return null;
		if (existing.state === 'cancelled') return { command: existing, cancelled: true };
		if (
			['completed', 'failed'].includes(existing.state) ||
			!existing.leaseExpiresAt ||
			existing.leaseExpiresAt <= now
		) {
			return null;
		}
		const renewed = await this.db
			.update(agentCommands)
			.set({ leaseExpiresAt: new Date(now.getTime() + leaseMs) })
			.where(
				and(
					eq(agentCommands.id, commandId),
					eq(agentCommands.agentId, agentId),
					eq(agentCommands.leaseOwner, leaseToken),
					inArray(agentCommands.state, ['leased', 'acknowledged', 'running']),
					gt(agentCommands.leaseExpiresAt, now)
				)
			)
			.returning();
		return renewed[0] ? { command: renewed[0], cancelled: false } : null;
	}
}
