/**
 * A deliberately non-secret classification of the point at which an ephemeral
 * BACKUP_FILESYSTEM payload could not be assembled. The agent never receives
 * this object; AgentService uses it only to emit an operator-facing server log.
 */
export type RemoteCommandPreparationStage =
	| 'command-ownership'
	| 'command-reference'
	| 'managed-records'
	| 'managed-plan-consistency'
	| 'repository-agent'
	| 'repository-metadata'
	| 'plan-shape'
	| 'source-validation'
	| 'repository-path'
	| 'agent-capability'
	| 'sftp-storage-lookup'
	| 'sftp-credential-decryption'
	| 'sftp-setting-allowlist'
	| 'sftp-option-validation'
	| 'sftp-required-credentials'
	| 'repository-secret-decryption'
	| 'lifecycle-configuration'
	| 'database-credential-preparation'
	| 'payload'
	| 'materializer-unavailable'
	| 'unexpected';

/**
 * Non-secret rule identifiers used when an SFTP option is rejected. Keep this
 * as a closed set so diagnostics can explain the validation rule without ever
 * copying the rejected value into the log.
 */
export type RemoteCommandPreparationRuleCategory =
	| 'unsupported-field'
	| 'unsafe-control-character'
	| 'value-too-long';

export type RemoteCommandPreparationFailure = {
	stage: RemoteCommandPreparationStage;
	backupId?: string;
	planId?: string;
	storageId?: string;
	rejectedField?: string;
	ruleCategory?: RemoteCommandPreparationRuleCategory;
};

function preparationFailureMessage(stage: RemoteCommandPreparationStage): string {
	const messages: Record<RemoteCommandPreparationStage, string> = {
		'command-ownership': 'The leased command did not belong to the requesting agent.',
		'command-reference': 'The durable remote backup command reference was invalid.',
		'managed-records': 'Remote managed backup records could not be loaded.',
		'managed-plan-consistency': 'Remote managed plan state no longer matches its command.',
		'repository-agent': 'The managed repository does not belong to the requesting agent.',
		'repository-metadata': 'Managed repository metadata no longer matches the backup plan.',
		'plan-shape': 'The remote backup plan is no longer supported.',
		'source-validation': 'The remote backup source configuration is no longer valid.',
		'repository-path': 'The managed remote repository path is no longer valid.',
		'agent-capability': 'The remote agent no longer supports filesystem backup.',
		'sftp-storage-lookup': 'The remote SFTP destination could not be loaded.',
		'sftp-credential-decryption': 'Remote SFTP credentials could not be decrypted or validated.',
		'sftp-setting-allowlist': 'Remote SFTP settings are not supported for filesystem backup.',
		'sftp-option-validation': 'Remote SFTP configuration contains an unsafe value.',
		'sftp-required-credentials':
			'Remote filesystem backups require SFTP host, username, and password credentials.',
		'repository-secret-decryption': 'The managed remote repository secret could not be decrypted.',
		'lifecycle-configuration': 'The remote backup lifecycle configuration is not supported.',
		'database-credential-preparation': 'Database backup credentials could not be prepared.',
		'payload': 'The remote backup command payload could not be prepared.',
		'materializer-unavailable': 'The remote backup materializer is unavailable.',
		'unexpected': 'An unexpected remote command preparation error occurred.',
	};
	return messages[stage];
}

/**
 * This error retains only correlation IDs and a fixed safe message. In
 * particular, it never wraps the source exception because provider or
 * decryption errors may contain credential material.
 */
export class RemoteCommandPreparationError extends Error {
	readonly stage: RemoteCommandPreparationStage;
	readonly safeMessage: string;
	readonly backupId?: string;
	readonly planId?: string;
	readonly storageId?: string;
	readonly rejectedField?: string;
	readonly ruleCategory?: RemoteCommandPreparationRuleCategory;

	constructor(
		failure: RemoteCommandPreparationFailure,
		message = preparationFailureMessage(failure.stage)
	) {
		super(message);
		this.name = 'RemoteCommandPreparationError';
		this.stage = failure.stage;
		this.safeMessage = preparationFailureMessage(failure.stage);
		this.backupId = failure.backupId;
		this.planId = failure.planId;
		this.storageId = failure.storageId;
		// Option names are useful for diagnosis, but do not allow arbitrary
		// characters or unbounded input into structured server logs.
		if (failure.rejectedField) {
			const sanitizedField = failure.rejectedField.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 128);
			if (sanitizedField) this.rejectedField = sanitizedField;
		}
		const ruleCategories: RemoteCommandPreparationRuleCategory[] = [
			'unsupported-field',
			'unsafe-control-character',
			'value-too-long',
		];
		if (failure.ruleCategory && ruleCategories.includes(failure.ruleCategory)) {
			this.ruleCategory = failure.ruleCategory;
		}
	}
}
