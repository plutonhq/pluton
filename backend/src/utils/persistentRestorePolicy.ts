import { z } from 'zod';
import { AppError } from './AppError';
import { recoveryTargetSchema } from './recoveryTestPolicy';
import { RESTORE_PURPOSE } from '../types/databaseRestores';

export const restoreId = z.string().regex(/^[a-f0-9]{24}$/);
export const restoreDatabaseName = z
	.string()
	.regex(/^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/)
	.refine(
		name =>
			![
				'mysql',
				'sys',
				'postgres',
				'template0',
				'template1',
				'information_schema',
				'performance_schema',
				'pluton_recovery_guard',
				'pluton_restore_guard',
			].includes(name.toLowerCase())
	);
export const restoreSelection = z
	.object({
		planId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
		backupId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
		snapshotId: z.string().regex(/^[a-f0-9]{64}$/),
	})
	.strict();
export const restoreRequest = restoreSelection
	.extend({
		databaseId: z.string().regex(/^db_[A-Za-z0-9_-]{1,80}$/),
		metadataToken: z.string().regex(/^[a-f0-9]{64}$/),
		mode: z.enum(['internal', 'custom']),
		targetId: restoreId.optional(),
		ttlSeconds: z
			.number()
			.int()
			.min(3600)
			.max(30 * 86400),
		resourcesAcknowledged: z.literal(true),
		securityAcknowledged: z.literal(true),
	})
	.strict()
	.refine(input => input.mode !== 'custom' || !!input.targetId);
export const persistentApprovalBase = z
	.object({
		version: z.literal(1),
		id: restoreId,
		purpose: z.literal(RESTORE_PURPOSE),
		mode: z.enum(['internal', 'custom']),
		activationId: z.string().regex(/^[a-f0-9]{32}$/),
		engine: z.enum(['mariadb', 'mysql', 'postgresql']),
		database: restoreDatabaseName,
		target: recoveryTargetSchema.safeExtend({
			engine: z.enum(['mariadb', 'mysql', 'postgresql']),
			tls: z.literal('verify-identity'),
			enabled: z.literal(true),
			password: recoveryTargetSchema.shape.password.unwrap().min(1),
		}),
		caSha256: z.string().regex(/^[a-f0-9]{64}$/),
		maxSqlBytes: z
			.number()
			.int()
			.positive()
			.max(448 * 1024 ** 2),
		maxRetentionSeconds: z
			.number()
			.int()
			.min(86400)
			.max(30 * 86400),
		storage: z
			.object({
				id: z.string().regex(/^[a-f0-9-]{32,36}$/),
				quotaBytes: z
					.number()
					.int()
					.min(512 * 1024 ** 2)
					.max(2 * 1024 ** 3),
				kind: z.enum(['fixed-ext4', 'operator-approved-external']),
			})
			.strict(),
		binding: z
			.object({
				restoreId,
				snapshotId: z.string().regex(/^[a-f0-9]{64}$/),
				sha256: z.string().regex(/^[a-f0-9]{64}$/),
			})
			.strict()
			.optional(),
		containerId: z
			.string()
			.regex(/^[a-f0-9]{64}$/)
			.optional(),
	})
	.strict();
export const persistentApprovalSchema = persistentApprovalBase.superRefine((value, ctx) => {
	if (
		value.engine !== value.target.engine ||
		(value.mode === 'internal' &&
			(!value.binding || !value.containerId || value.storage.kind !== 'fixed-ext4')) ||
		(value.mode === 'custom' && value.storage.kind !== 'operator-approved-external')
	)
		ctx.addIssue({ code: 'custom', message: 'Invalid persistent target contract.' });
	if (['root', 'postgres', 'admin', 'administrator'].includes(value.target.username.toLowerCase()))
		ctx.addIssue({
			code: 'custom',
			message: 'An administrator database account is not a restore account.',
		});
});
export function restoreInput<T>(schema: z.ZodType<T>, input: unknown): T {
	const result = schema.safeParse(input);
	if (!result.success) throw new AppError(400, 'Invalid persistent database restore request.');
	return result.data;
}
/** Closed categories only. Never retain native output or arbitrary exception messages. */
export class DatabaseRestoreError extends AppError {
	constructor(
		readonly code: string,
		readonly stage?: string
	) {
		super(409, `Database restore refused (${code}).`);
		Object.setPrototypeOf(this, new.target.prototype);
	}
}
