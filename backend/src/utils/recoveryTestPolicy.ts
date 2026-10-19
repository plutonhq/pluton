import { z } from 'zod';
import { AppError } from './AppError';
import type { RecoveryPolicy } from '../types/recoveryTests';

export const recoveryEngineSchema = z.enum(['mariadb', 'mysql', 'postgresql']);
export const recoveryPolicySchema = z
	.object({
		enabled: z.boolean(),
		databaseImport: z.enum(['disabled', 'required']),
		targetModes: z
			.object({
				mariadb: z.enum(['internal', 'custom']).optional(),
				postgresql: z.enum(['internal', 'custom']).optional(),
				mysql: z.enum(['internal', 'custom']).optional(),
			})
			.strict()
			.optional(),
	})
	.strict();
export const recoveryTargetSchema = z
	.object({
		engine: recoveryEngineSchema,
		host: z
			.string()
			.min(1)
			.max(253)
			.regex(/^(?:[A-Za-z0-9][A-Za-z0-9.:-]*|::1)$/),
		port: z.number().int().min(1).max(65535),
		username: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/),
		tls: z.enum(['local', 'verify-identity']),
		enabled: z.boolean(),
		dedicated: z.literal(true),
		password: z
			.string()
			.max(4096)
			.refine(value => !/[\r\n\0]/.test(value))
			.optional(),
	})
	.strict()
	.superRefine((target, context) => {
		if (target.tls === 'local' && !['localhost', '127.0.0.1', '::1'].includes(target.host))
			context.addIssue({
				code: 'custom',
				message: 'Remote recovery targets require verified TLS.',
			});
	});
export const defaultRecoveryPolicy: RecoveryPolicy = { enabled: false, databaseImport: 'disabled' };
export function parseRecoveryInput<T>(schema: z.ZodType<T>, input: unknown): T {
	const parsed = schema.safeParse(input);
	// Zod errors can contain provided credentials. Never return them.
	if (!parsed.success) throw new AppError(400, 'Invalid recovery testing configuration.');
	return parsed.data;
}
