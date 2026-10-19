import { and, eq } from 'drizzle-orm';
import { DatabaseType } from '../db';
import { agentCommands, type AgentCommand } from '../db/schema/agents';
import { backups, type Backup, type NewBackup } from '../db/schema/backups';
import {
	remoteManagedRepositories,
	type NewRemoteManagedRepository,
	type RemoteManagedRepository,
} from '../db/schema/remoteManagedRepositories';

/**
 * Persistence boundary for the managed remote data-plane. It deliberately
 * writes a non-secret command payload alongside its Backup row in the same
 * transaction, so restarting the control plane cannot lose a scheduled run.
 */
export class RemoteManagedRepositoryStore {
	constructor(private readonly db: DatabaseType) {}

	async getByPlanId(planId: string): Promise<RemoteManagedRepository | null> {
		return (
			(await this.db.query.remoteManagedRepositories.findFirst({
				where: eq(remoteManagedRepositories.planId, planId),
			})) || null
		);
	}

	async getById(id: string): Promise<RemoteManagedRepository | null> {
		return (
			(await this.db.query.remoteManagedRepositories.findFirst({
				where: eq(remoteManagedRepositories.id, id),
			})) || null
		);
	}

	async create(data: NewRemoteManagedRepository): Promise<RemoteManagedRepository | null> {
		const created = await this.db.insert(remoteManagedRepositories).values(data).returning();
		return created[0] || null;
	}

	async deleteByPlanId(planId: string): Promise<boolean> {
		const result = await this.db
			.delete(remoteManagedRepositories)
			.where(eq(remoteManagedRepositories.planId, planId));
		return result.changes > 0;
	}

	async markInitialized(id: string): Promise<RemoteManagedRepository | null> {
		const updated = await this.db
			.update(remoteManagedRepositories)
			.set({ initializedAt: new Date(), updatedAt: new Date() })
			.where(eq(remoteManagedRepositories.id, id))
			.returning();
		return updated[0] || null;
	}

	async createBackupAndCommand(input: {
		backup: NewBackup;
		command: {
			id: string;
			agentId: string;
			idempotencyKey: string;
			payload: { backupId: string; planId: string; repositoryId: string };
		};
	}): Promise<{ backup: Backup; command: AgentCommand }> {
		const planId = input.backup.planId;
		if (!planId) throw new Error('Remote backup requires a plan ID.');
		return this.db.transaction(tx => {
			const active = tx
				.select({ id: backups.id })
				.from(backups)
				.where(and(eq(backups.planId, planId), eq(backups.inProgress, true)))
				.get();
			if (active) {
				throw new Error('A remote backup is already active for this plan.');
			}
			const backup = tx.insert(backups).values(input.backup).returning().get();
			if (!backup) throw new Error('Could not create remote backup record.');
			const command = tx
				.insert(agentCommands)
				.values({
					id: input.command.id,
					agentId: input.command.agentId,
					type: 'BACKUP_FILESYSTEM',
					payload: input.command.payload,
					idempotencyKey: input.command.idempotencyKey,
				})
				.returning()
				.get();
			if (!command) throw new Error('Could not enqueue remote backup command.');
			return { backup, command };
		});
	}
}
