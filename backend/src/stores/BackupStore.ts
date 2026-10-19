import { and, desc, eq, gte, lt } from 'drizzle-orm';
import { sql } from 'drizzle-orm/sql';
import { DatabaseType } from '../db';
import { Backup, NewBackup, backups } from '../db/schema/backups';
import { BackupMirror } from '../types/backups';
import { mergeRemoteProgress, type RemoteProgressEvent } from '../utils/remoteBackupProgress';
import type { BackupHistoryQuery } from '../utils/backupHistoryQuery';

// Explicit projection: never hydrate source/storage configuration or credentials
// just to render history. Shared with the bounded plan-header summary.
export const backupHistoryColumns = {
	id: true,
	title: true,
	description: true,
	status: true,
	inProgress: true,
	errorMsg: true,
	download: true,
	createdAt: true,
	started: true,
	ended: true,
	completionStats: true,
	taskStats: true,
	mirrors: true,
} as const;

// This is the Date column's existing ended -> started fallback (created for old
// rows missing both). Keep this expression identical to migration 0013.
export const backupHistoryDate = sql<number>`coalesce(${backups.ended}, ${backups.started}, ${backups.createdAt})`;

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

	async getHistoryPage(planId: string, query: BackupHistoryQuery) {
		const where = and(
			eq(backups.planId, planId),
			sql`coalesce(${backups.inProgress}, 0) = 0`,
			query.from === undefined ? undefined : gte(backupHistoryDate, query.from),
			query.until === undefined ? undefined : lt(backupHistoryDate, query.until)
		);
		// Synchronous SQLite transaction: count and page share one read snapshot.
		return this.db.transaction(tx => {
			const total = tx
				.select({ count: sql<number>`count(*)` })
				.from(backups)
				.where(where)
				.get()!.count;
			const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
			const page = Math.min(query.page, totalPages);
			const offset = (page - 1) * query.pageSize;
			const items = tx.query.backups
				.findMany({
					where,
					columns: backupHistoryColumns,
					orderBy: [desc(backupHistoryDate), desc(backups.id)],
					limit: query.pageSize,
					offset,
				})
				.sync();
			return {
				items,
				total,
				page,
				pageSize: query.pageSize,
				totalPages,
				hasPrevious: page > 1,
				hasNext: page < totalPages,
				timeZone: query.timeZone,
			};
		});
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

	async updateRemoteProgress(
		id: string,
		planId: string,
		commandId: string,
		attempt: number,
		sequence: number,
		event: RemoteProgressEvent
	): Promise<Backup | null> {
		return this.db.transaction(tx => {
			const current = tx.select().from(backups).where(eq(backups.id, id)).get();
			if (!current || current.planId !== planId || current.sourceId === 'main') return null;
			const update = mergeRemoteProgress(current, commandId, attempt, sequence, event);
			if (!update) return null;
			return (
				tx
					.update(backups)
					.set({ ...update, updatedAt: sql`(unixepoch())` })
					.where(eq(backups.id, id))
					.returning()
					.get() || null
			);
		});
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
