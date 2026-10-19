import { sql } from 'drizzle-orm';
import type { DatabaseType } from '../db';
import { AppError } from './AppError';
import type Database from 'better-sqlite3';
import type { NewPlan, Plan } from '../db/schema/plans';
import type { Storage } from '../db/schema/storages';
import { providers } from './providers';

type ReplicaScope = { authority: string; prefix: string };
type ReplicaScopeResolver = (storage: Storage, repositoryPath?: string | null) => ReplicaScope;
let replicaScopeResolver: ReplicaScopeResolver | undefined;

/** Startup owns credential access; importing a store must not bootstrap the application. */
export function configureReplicaScopeResolver(resolver: ReplicaScopeResolver | undefined): void {
	replicaScopeResolver = resolver;
}
type PlanReference = {
	storageId?: string | null;
	storagePath?: string | null;
	replicationId?: string;
};
type PlanScope = Pick<
	NewPlan,
	'id' | 'storageId' | 'storagePath' | 'settings' | 'method' | 'sourceType' | 'sourceId'
>;
const overlaps = (a: ReplicaScope, b: ReplicaScope) =>
	a.authority === b.authority &&
	(!a.prefix ||
		!b.prefix ||
		a.prefix === b.prefix ||
		a.prefix.startsWith(b.prefix + '/') ||
		b.prefix.startsWith(a.prefix + '/'));
const isolationError = () =>
	new AppError(
		409,
		'Repository scope overlaps an owned or retained managed replica. Select a separate repository prefix.'
	);
const hasDestinations = (sqlite: Database.Database) =>
	!!sqlite
		.prepare(
			"SELECT 1 FROM sqlite_master WHERE type='table' AND name='managed_replication_destinations'"
		)
		.get();

function storedScope(
	sqlite: Database.Database,
	reference: PlanReference,
	override?: Storage
): ReplicaScope | null {
	if (!reference.storageId) return null;
	const row =
		override?.id === reference.storageId
			? override
			: (sqlite.prepare('SELECT * FROM storages WHERE id=?').get(reference.storageId) as
					| Storage
					| undefined);
	if (!row || (row.type !== 's3' && providers[row.type || '']?.type !== 's3')) return null;
	if (!replicaScopeResolver)
		throw new AppError(503, 'Managed replica scope verification is not configured.');
	const storage = {
		...row,
		credentials:
			typeof row.credentials === 'string' ? JSON.parse(row.credentials) : row.credentials,
		settings: typeof row.settings === 'string' ? JSON.parse(row.settings) : row.settings,
	};
	return replicaScopeResolver(storage, reference.storagePath);
}

function references(plan: PlanScope): PlanReference[] {
	return [
		{ storageId: plan.storageId, storagePath: plan.storagePath },
		...(plan.settings.replication?.storages || []),
	];
}

/** Run within the same immediate transaction as the plan/credential write. */
export function assertPlanReplicaIsolation(
	sqlite: Database.Database,
	plan: PlanScope,
	override?: Storage
): void {
	if (!hasDestinations(sqlite)) return;
	const destinations = sqlite
		.prepare('SELECT * FROM managed_replication_destinations')
		.all() as Array<any>;
	if (!destinations.length) return;
	for (const reference of references(plan)) {
		const scope = storedScope(sqlite, reference, override);
		if (!scope) continue;
		for (const destination of destinations) {
			if (
				!overlaps(scope, {
					authority: destination.destination_authority,
					prefix: destination.destination_prefix,
				})
			)
				continue;
			const ownsReplica =
				plan.method === 'backup' &&
				plan.sourceType === 'device' &&
				plan.sourceId !== 'main' &&
				plan.id === destination.plan_id &&
				reference.replicationId === destination.replication_id &&
				reference.storageId === destination.destination_storage_id &&
				reference.storagePath === destination.destination_storage_path &&
				destination.init_state !== 'detached';
			if (!ownsReplica) throw isolationError();
		}
	}
}

/** Counterpart to plan writes: a late reservation cannot race an existing plan. */
export function assertReplicaNotPlanOwned(
	sqlite: Database.Database,
	candidate: ReplicaScope & { planId: string }
): void {
	const plans = sqlite
		.prepare('SELECT id,storage_id,storage_path,settings FROM plans WHERE id!=?')
		.all(candidate.planId) as Array<any>;
	for (const row of plans) {
		const plan = {
			...row,
			storageId: row.storage_id,
			storagePath: row.storage_path,
			settings: JSON.parse(row.settings || '{}'),
		} as Plan;
		for (const reference of references(plan)) {
			const scope = storedScope(sqlite, reference);
			if (scope && overlaps(candidate, scope)) throw isolationError();
		}
	}
}

/** Storage aliases cannot redirect a registered plan into a reserved prefix. */
export function assertStorageReplicaIsolation(sqlite: Database.Database, storage: Storage): void {
	if (!hasDestinations(sqlite)) return;
	for (const row of sqlite.prepare('SELECT * FROM plans').all() as Array<any>) {
		const plan = {
			...row,
			storageId: row.storage_id,
			storagePath: row.storage_path,
			sourceType: row.source_type,
			sourceId: row.source_id,
			settings: JSON.parse(row.settings || '{}'),
		} as Plan;
		if (references(plan).some(reference => reference.storageId === storage.id))
			assertPlanReplicaIsolation(sqlite, plan, storage);
	}
}

export function assertPlanUpdateReplicaIsolation(
	sqlite: Database.Database,
	id: string,
	updates: Partial<Plan>
): void {
	if (!hasDestinations(sqlite)) return;
	const row = sqlite.prepare('SELECT * FROM plans WHERE id=?').get(id) as any;
	if (!row) return;
	assertPlanReplicaIsolation(sqlite, {
		...row,
		storageId: row.storage_id,
		storagePath: row.storage_path,
		sourceType: row.source_type,
		sourceId: row.source_id,
		settings: JSON.parse(row.settings || '{}'),
		...updates,
	});
}

export function assertStorageUpdateReplicaIsolation(
	sqlite: Database.Database,
	id: string,
	updates: Partial<Storage>
): Storage | undefined {
	if (!hasDestinations(sqlite)) return;
	const row = sqlite.prepare('SELECT * FROM storages WHERE id=?').get(id) as any;
	if (!row) return;
	const next = {
		...row,
		credentials: JSON.parse(row.credentials || '{}'),
		settings: JSON.parse(row.settings || '{}'),
		...updates,
	} as Storage;
	assertStorageReplicaIsolation(sqlite, next);
	return next;
}

/** Common server limit; UI limits never substitute for API enforcement. */
export function validateReplicationSettings(settings: unknown): void {
	if (settings === undefined || settings === null) return;
	if (typeof settings !== 'object' || Array.isArray(settings))
		throw new AppError(400, 'Invalid replication settings.');
	const value = settings as { enabled?: unknown; concurrent?: unknown; storages?: unknown };
	if (
		typeof value.enabled !== 'boolean' ||
		(value.concurrent !== undefined && typeof value.concurrent !== 'boolean') ||
		!Array.isArray(value.storages) ||
		value.storages.length > 2
	)
		throw new AppError(400, 'Select zero, one or two replication destinations.');
	const seen = new Set<string>();
	for (const raw of value.storages) {
		const item = raw as { replicationId?: unknown; storageId?: unknown; storagePath?: unknown };
		if (
			!item ||
			typeof item.replicationId !== 'string' ||
			!/^[A-Za-z0-9_-]{1,100}$/.test(item.replicationId) ||
			typeof item.storageId !== 'string' ||
			!item.storageId ||
			typeof item.storagePath !== 'string' ||
			seen.has(item.replicationId)
		)
			throw new AppError(
				400,
				'Each replica requires a unique identity and an exact repository path.'
			);
		seen.add(item.replicationId);
	}
}

export function assertManagedReplicationIdle(
	db: Pick<DatabaseType, 'get'>,
	source: { planId?: string; backupId?: string }
): void {
	const where = source.planId ? sql`plan_id=${source.planId}` : sql`backup_id=${source.backupId!}`;
	if (
		db.get(
			sql`SELECT 1 FROM managed_replication_jobs WHERE ${where} AND status IN ('pending','running','uncertain') LIMIT 1`
		)
	)
		throw new AppError(
			409,
			'Managed replication is pending, active or uncertain. Resolve it before changing or removing this source.'
		);
}
