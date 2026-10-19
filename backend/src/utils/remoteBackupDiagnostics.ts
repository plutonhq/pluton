/** Closed diagnostics only. Never incorporate agent/provider text, credentials or URLs. */
const messages: Record<string, string> = {
	'database-invalid-configuration':
		'The database name or native client connection configuration is invalid. Check the saved database configuration; dump defaults were not changed.',
	'invalid-payload': 'The backup command configuration is invalid.',
	'source-validation-failed':
		'The source could not be validated. Run the local read-only source preflight.',
	'state-overlap': 'The source overlaps private agent state; backup was refused.',
	'state-validation-failed': 'Private agent state could not be validated.',
	'tool-unavailable': 'The private backup tools are unavailable.',
	'sftp-password-obscure-failed':
		'The private SFTP authentication configuration could not be prepared.',
	'temporary-config-failed': 'Private temporary storage configuration could not be prepared.',
	'repository-check-failed': 'The repository could not be checked.',
	'repository-target-check-failed': 'The managed repository target could not be checked.',
	'repository-target-not-empty':
		'Repository initialization was refused because the target is not empty.',
	'target-check-access-failed': 'Access to the managed repository target was denied.',
	'target-check-auth-failed': 'Storage authentication failed.',
	'target-check-transport-failed': 'The storage connection failed.',
	'repository-initialization-failed': 'The managed repository could not be initialized.',
	'restic-backup-failed': 'Restic backup failed; no successful snapshot was confirmed.',
	'restic-summary-missing': 'No valid snapshot summary was returned.',
	'cleanup-failed': 'Private temporary state cleanup needs attention.',
	'unexpected': 'Remote backup failed unexpectedly.',
	'workspace-failed': 'The private lifecycle workspace could not be prepared.',
	'hook-invalid': 'The configured hook violates the allowed hook policy.',
	'hook-failed': 'The configured hook failed.',
	'hook-timeout': 'The configured hook exceeded its timeout.',
	'hook-output-limit': 'The configured hook exceeded its output limit.',
	'snapshot-confirmation-failed':
		'The exact snapshot and required artifacts could not be confirmed.',
	'source-parent-not-traversable':
		'The service account cannot traverse a source parent directory. Run the read-only agent preflight and review only the required traverse permissions.',
	'source-root-not-readable':
		'The source root is not readable/traversable by pluton-agent. Review read-only access to its canonical path.',
	'source-entry-inaccessible':
		'A source file or directory is inaccessible to pluton-agent. Run the explicit read-only source scan; do not broaden permissions automatically.',
	'source-missing': 'The configured source or an expected source entry is missing.',
	'source-symlink-escape':
		'The source symlink resolves outside its allowed roots or changed during validation.',
	'source-unsupported-type': 'The selected source has an unsupported file type.',
	'source-policy-violation':
		'The source violates canonical allowed-root containment or path policy.',
	'database-auth-failed':
		'Database authentication failed. Verify the backup credential and authentication policy.',
	'database-insufficient-privileges':
		'Database dump privileges are insufficient. Review database grants and requested routines/events; the password may be correct. Dump options were not changed.',
	'database-unavailable':
		'The database connection failed. Check the configured host, port and network reachability.',
	'database-tls-verification-failed':
		'Database TLS verification failed. Check trusted CA material and the server identity; do not disable verification to force a pass.',
	'database-dump-timeout': 'The database dump exceeded its configured timeout.',
	'database-tool-unavailable': 'The required database dump client is unavailable.',
	'database-client-missing': 'The required database dump client is missing or cannot be started.',
	'database-client-incompatible': 'The database dump client is incompatible with the server.',
	'lifecycle-invalid': 'The database/hooks configuration is invalid.',
	'database-dump-invalid': 'Database dump output is invalid.',
	'database-output-empty': 'The database dump produced no valid SQL output.',
	'database-dump-failed':
		'The database dump failed. A partial temporary SQL file is not a successful backup.',
	'database-dump-output-limit': 'The database dump exceeded its configured output limit.',
	'cancelled': 'The remote backup was cancelled.',
};
const stages = new Set([
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
export function remoteBackupFailure(input: {
	failureStage?: string;
	failureCode?: string;
	databaseId?: string;
	engine?: string;
	cancelled?: boolean;
}): string {
	const code = input.cancelled ? 'cancelled' : input.failureCode;
	const message =
		code && Object.hasOwn(messages, code)
			? messages[code]
			: 'Remote backup failed. Review the agent safe stage/code diagnostics.';
	// These metadata identifiers are separately validated against the closed API schemas.
	const stage =
		input.failureStage && stages.has(input.failureStage) ? input.failureStage : 'unknown-stage';
	const safeCode = code && Object.hasOwn(messages, code) ? code : 'unspecified';
	const database =
		input.databaseId && /^db_[A-Za-z0-9_-]{1,80}$/.test(input.databaseId)
			? `; databaseId=${input.databaseId}; engine=${['mariadb', 'mysql', 'postgresql'].includes(input.engine || '') ? input.engine : 'unknown'}`
			: '';
	return `${message} (${stage}/${safeCode}${database}).`;
}
