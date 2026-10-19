import crypto from 'crypto';
import { z } from 'zod';
import type { RecoveryPolicy, RecoveryDatabaseResult } from '../types/recoveryTests';
import { AppError } from './AppError';
import { parseRecoveryInput, recoveryPolicySchema } from './recoveryTestPolicy';

export const recoverySnapshotSelection = z
	.object({
		backupId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
		snapshotId: z.string().regex(/^[a-f0-9]{64}$/),
	})
	.strict();
export const recoveryManualSelection = recoverySnapshotSelection
	.extend({
		metadataToken: z.string().regex(/^[a-f0-9]{64}$/),
		selection: recoveryPolicySchema.omit({ enabled: true }),
		resourcesAcknowledged: z.literal(true),
	})
	.strict();
export type RecoveryManualSelection = z.infer<typeof recoveryManualSelection>;
export type RecoveryMetadata = {
	planId: string;
	backupId: string;
	repositoryId: string;
	snapshotId: string;
	databases: RecoveryDatabaseResult[];
};
/** A stale-data fingerprint, not a security token or an authorization grant.
 * Every confirmation re-reads the exact repository and revalidates the receipt. */
export function recoveryMetadataToken(metadata: RecoveryMetadata) {
	return crypto.createHash('sha256').update(JSON.stringify(metadata)).digest('hex');
}
export function manualRecoveryPolicy(
	saved: RecoveryPolicy,
	input: unknown,
	entries: RecoveryDatabaseResult[]
) {
	const request = parseRecoveryInput(recoveryManualSelection, input);
	if (saved.databaseImport === 'required' && request.selection.databaseImport !== 'required')
		throw new AppError(409, 'This plan requires native import of every recorded database.');
	if (
		request.selection.databaseImport === 'required' &&
		entries.some(entry => !entry.engine || !entry.database)
	)
		throw new AppError(
			409,
			'Historical database engine/name metadata is incomplete. Native import is unavailable.'
		);
	const policy: RecoveryPolicy = {
		enabled: false, // operation only: never enable automation or update saved plan policy
		databaseImport: request.selection.databaseImport,
		targetModes: request.selection.targetModes || {},
	};
	const internal = new Set(
		entries
			.filter(entry => entry.engine && policy.targetModes?.[entry.engine] === 'internal')
			.map(entry => entry.engine)
	);
	if (policy.databaseImport === 'required' && internal.size > 1)
		throw new AppError(
			409,
			'Only one Internal engine is allowed. Keep other engines on approved Custom targets.'
		);
	return policy;
}
