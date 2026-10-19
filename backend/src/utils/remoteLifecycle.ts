import Cryptr from 'cryptr';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from './AppError';
import type { PlanBackupSettings } from '../types/plans';
import type {
	DatabaseCredential,
	RemoteBackupLifecycle,
	RemoteDatabaseBackup,
} from '../types/remoteLifecycle';

export const MAX_PLAN_DATABASES = 8;
export const databaseIdSchema = z.string().regex(/^db_[a-zA-Z0-9_-]{1,64}$/);

const hookSchema = z
	.object({
		id: z.string().regex(/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}$/),
		args: z
			.array(
				z
					.string()
					.max(128)
					.regex(/^[A-Za-z0-9_.,:@/+ =-]*$/)
					.refine(
						arg => !arg.startsWith('-') && !arg.startsWith('/') && !arg.split('/').includes('..')
					)
			)
			.max(16),
		timeoutSeconds: z.number().int().min(1).max(300),
	})
	.strict();

const databaseSchema = z
	.object({
		databaseId: databaseIdSchema.optional(),
		engine: z.enum(['mysql', 'mariadb', 'postgresql']),
		host: z
			.string()
			.max(253)
			.regex(/^(?:[A-Za-z0-9][A-Za-z0-9.:-]*|::1)$/),
		port: z.number().int().min(1).max(65535),
		tls: z.enum(['verify-identity', 'local']),
		database: z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/),
		username: z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,79}$/),
		dumpFilename: z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,95}\.sql$/),
		timeoutSeconds: z.number().int().min(1).max(3600),
		maxDumpBytes: z
			.number()
			.int()
			.min(1024)
			.max(100 * 1024 ** 3),
		includeRoutines: z.boolean(),
		includeEvents: z.boolean(),
		password: z
			.string()
			.min(1)
			.max(1024)
			.refine(value => !value.includes('\0'))
			.optional(),
		passwordConfigured: z.boolean().optional(),
	})
	.strict()
	.refine(db => db.tls !== 'local' || ['localhost', '127.0.0.1', '::1'].includes(db.host))
	.refine(
		db =>
			db.engine !== 'postgresql' ||
			(db.database.length <= 63 &&
				db.username.length <= 63 &&
				!db.includeRoutines &&
				!db.includeEvents &&
				(db.password === undefined || !/[\r\n]/.test(db.password)))
	);

const hooks = {
	preHook: hookSchema.optional(),
	postHook: hookSchema.optional(),
};
export const remoteLifecycleSchema = z.union([
	z
		.object({
			version: z.literal(1),
			database: databaseSchema
				.refine(db => db.engine !== 'postgresql' && db.databaseId === undefined)
				.optional(),
			...hooks,
		})
		.strict(),
	z
		.object({
			version: z.literal(2),
			databases: z.array(databaseSchema).max(MAX_PLAN_DATABASES),
			...hooks,
		})
		.strict()
		.refine(value => {
			const names = value.databases.map(db => db.dumpFilename.normalize('NFKC').toLowerCase());
			const ids = value.databases.flatMap(db => (db.databaseId ? [db.databaseId] : []));
			return new Set(names).size === names.length && new Set(ids).size === ids.length;
		}),
]);

export function lifecycleDatabases(lifecycle: RemoteBackupLifecycle): RemoteDatabaseBackup[] {
	return lifecycle.version === 2
		? lifecycle.databases || []
		: lifecycle.database
			? [lifecycle.database]
			: [];
}

/** API normalization, ID ownership, and encryption happen together, before persistence. */
export function prepareRemoteLifecycleCollection(
	settings: PlanBackupSettings,
	previous: RemoteBackupLifecycle | undefined,
	credentials: DatabaseCredential[],
	secret: string
): { settings: PlanBackupSettings; credentials: DatabaseCredential[] } {
	const input = parseRemoteLifecycle(settings.remoteLifecycle);
	const existing = previous ? lifecycleDatabases(parseRemoteLifecycle(previous)) : [];
	const entries = lifecycleDatabases(input);
	if (input.version === 1 && entries.length && existing.length > 1)
		throw new AppError(400, 'A single-database request cannot replace a multi-database plan.');
	const saved: RemoteDatabaseBackup[] = [];
	const prepared: DatabaseCredential[] = [];
	for (const entry of entries) {
		const inheritedId =
			input.version === 1 && existing.length === 1 ? existing[0].databaseId : undefined;
		const databaseId = entry.databaseId || inheritedId || `db_${randomUUID().replace(/-/g, '')}`;
		const old = credentials.find(credential => credential.databaseId === databaseId);
		if (
			(entry.databaseId || inheritedId) &&
			(!old || !existing.some(db => db.databaseId === databaseId))
		)
			throw new AppError(400, 'Database entry identity does not belong to this plan.');
		const { password, passwordConfigured: _ignored, ...config } = entry;
		const encryptedPassword =
			password === undefined ? old?.encryptedPassword : new Cryptr(secret).encrypt(password);
		if (!encryptedPassword)
			throw new AppError(400, 'A database password is required for each new database entry.');
		saved.push({ ...config, databaseId, passwordConfigured: true });
		prepared.push({ databaseId, encryptedPassword, legacySingle: old?.legacySingle || false });
	}
	const lifecycle: RemoteBackupLifecycle = {
		version: 2,
		databases: saved,
		preHook: input.preHook,
		postHook: input.postHook,
	};
	return {
		settings: {
			...settings,
			remoteLifecycle: saved.length || input.preHook || input.postHook ? lifecycle : undefined,
		},
		credentials: prepared,
	};
}

/** Only called at the authenticated agent-command materialization boundary. */
export function materializeRemoteLifecycleCollection(
	value: unknown,
	credentials: DatabaseCredential[],
	secret: string
): RemoteBackupLifecycle {
	const lifecycle = parseRemoteLifecycle(value);
	try {
		const databases = lifecycleDatabases(lifecycle).map(entry => {
			const credential = credentials.find(item => item.databaseId === entry.databaseId);
			if (!entry.databaseId || entry.password !== undefined || !credential)
				throw new Error('Unavailable');
			const { passwordConfigured: _ignored, ...config } = entry;
			return { ...config, password: new Cryptr(secret).decrypt(credential.encryptedPassword) };
		});
		return parseRemoteLifecycle({
			version: 2,
			databases,
			preHook: lifecycle.preHook,
			postHook: lifecycle.postHook,
		});
	} catch {
		throw new AppError(500, 'Database backup credentials could not be prepared.');
	}
}

/** Never expose zod input/error text: a failed field may contain a credential. */
export function parseRemoteLifecycle(value: unknown): RemoteBackupLifecycle {
	const parsed = remoteLifecycleSchema.safeParse(value);
	if (!parsed.success) throw new AppError(400, 'Remote backup lifecycle configuration is invalid.');
	return parsed.data;
}

/** Credentials live in a separate table, never in plan JSON or API responses. */
export function prepareRemoteLifecycleSettings(
	settings: PlanBackupSettings,
	existingCredential: string | null,
	secret: string
): { settings: PlanBackupSettings; credential?: string | null } {
	if (settings.remoteLifecycle === undefined) return { settings };
	const lifecycle = parseRemoteLifecycle(settings.remoteLifecycle);
	if (lifecycle.version !== 1)
		throw new AppError(400, 'Use the database collection credential boundary.');
	if (!lifecycle.database && !lifecycle.preHook && !lifecycle.postHook) {
		return { settings: { ...settings, remoteLifecycle: undefined }, credential: null };
	}
	let credential: string | null = null;
	if (lifecycle.database) {
		const { password, passwordConfigured: _ignored, ...database } = lifecycle.database;
		credential = password === undefined ? existingCredential : new Cryptr(secret).encrypt(password);
		if (!credential)
			throw new AppError(400, 'A database password is required when enabling database backup.');
		lifecycle.database = { ...database, passwordConfigured: true };
	}
	return { settings: { ...settings, remoteLifecycle: lifecycle }, credential };
}

export function materializeRemoteLifecycle(
	value: unknown,
	credential: string | null,
	secret: string
): RemoteBackupLifecycle {
	const lifecycle = parseRemoteLifecycle(value);
	if (!lifecycle.database) return lifecycle;
	if (lifecycle.database.password !== undefined || !credential) {
		throw new AppError(500, 'Database backup credentials could not be prepared.');
	}
	try {
		const { passwordConfigured: _ignored, ...database } = lifecycle.database;
		const password = new Cryptr(secret).decrypt(credential);
		return parseRemoteLifecycle({ ...lifecycle, database: { ...database, password } });
	} catch {
		throw new AppError(500, 'Database backup credentials could not be prepared.');
	}
}
