import { eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm/sql';
import { DatabaseType } from '../db';
import { Backup, NewBackup, backups } from '../db/schema/backups';
import { BackupMirror } from '../types/backups';

/**
 * BackupStore is a class for managing backup records in the database.
 */
export class BackupStore {
	private db: DatabaseType;
	/**
	 * Per-backup promise chain that serializes `updateMirrorStatus` calls
	 * to prevent lost-update races when concurrent replications modify the
	 * same mirrors JSON array.
	 */
	private mirrorUpdateChain = new Map<string, Promise<Backup | null>>();

	constructor(db: DatabaseType) {
		this.db = db;
	}

	async getAll(): Promise<Backup[] | null> {
		const backups = await this.db.query.backups.findMany();
		return backups || null;
	}

	async getById(backupId: string): Promise<Backup | null> {
		const backup = await this.db.query.backups.findFirst({
			where: eq(backups.id, backupId),
		});

		return backup || null;
	}

	async create(backupData: NewBackup): Promise<Backup | null> {
		const result = await this.db
			.insert(backups)
			.values({ ...backupData, createdAt: sql`(unixepoch())`, started: sql`(unixepoch())` })
			.returning();
		return result[0] || null;
	}

	async update(id: string, updates: Partial<NewBackup>): Promise<Backup | null> {
		const updatedPayload = { ...updates, updatedAt: sql`(unixepoch())` };
		const result = await this.db
			.update(backups)
			.set(updatedPayload)
			.where(eq(backups.id, id))
			.returning();

		return result[0] || null;
	}

	async updateMirrorStatus(
		backupId: string,
		replicationId: string,
		update: Partial<BackupMirror>
	): Promise<Backup | null> {
		// Chain concurrent calls for the same backup so each read-modify-write
		// sees the result of the previous one (prevents lost updates).
		const prev = this.mirrorUpdateChain.get(backupId) ?? Promise.resolve(null);
		const current = prev.then(async () => {
			const backup = await this.getById(backupId);
			if (!backup) return null;
			const currentMirrors = (backup.mirrors || []) as BackupMirror[];
			const exists = currentMirrors.some(m => m.replicationId === replicationId);

			let mirrors: BackupMirror[];
			if (exists) {
				// Update existing mirror entry
				mirrors = currentMirrors.map(m =>
					m.replicationId === replicationId ? { ...m, ...update } : m
				);
			} else {
				// Upsert: create a new mirror entry with the provided fields
				mirrors = [
					...currentMirrors,
					{
						replicationId,
						storageId: '',
						storageName: '',
						storagePath: '',
						storageType: '',
						status: 'pending',
						...update,
					} as BackupMirror,
				];
			}

			return this.update(backupId, { mirrors } as any);
		});
		this.mirrorUpdateChain.set(backupId, current);

		try {
			return await current;
		} finally {
			// Clean up when this is still the tail of the chain
			if (this.mirrorUpdateChain.get(backupId) === current) {
				this.mirrorUpdateChain.delete(backupId);
			}
		}
	}

	async delete(id: string): Promise<boolean> {
		const result = await this.db.delete(backups).where(eq(backups.id, id));
		return result.changes > 0;
	}

	async deleteByPlanId(id: string): Promise<boolean> {
		const result = await this.db.delete(backups).where(eq(backups.planId, id));
		return result.changes > 0;
	}
}
