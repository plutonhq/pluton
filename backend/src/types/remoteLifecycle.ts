/** Phase 5 remote managed plans only. Password is a write-only API input. */
export type RemoteDatabaseBackup = {
	/** Assigned by the server; never an array-index credential binding. */
	databaseId?: string;
	engine: 'mysql' | 'mariadb' | 'postgresql';
	host: string;
	port: number;
	tls: 'verify-identity' | 'local';
	database: string;
	username: string;
	dumpFilename: string;
	timeoutSeconds: number;
	maxDumpBytes: number;
	includeRoutines: boolean;
	includeEvents: boolean;
	password?: string;
	passwordConfigured?: boolean;
};

export type RemoteLifecycleHook = {
	/** Relative identifier under the agent's administrator-owned hook root. */
	id: string;
	args: string[];
	timeoutSeconds: number;
};

export type RemoteBackupLifecycle = {
	version: 1 | 2;
	/** Accepted for old single-database API clients only. */
	database?: RemoteDatabaseBackup;
	databases?: RemoteDatabaseBackup[];
	preHook?: RemoteLifecycleHook;
	postHook?: RemoteLifecycleHook;
};

export type DatabaseCredential = {
	databaseId: string;
	encryptedPassword: string;
	/** The additive migration preserves the old ciphertext until explicit edits. */
	legacySingle: boolean;
};

export type DatabaseArtifact = {
	databaseId: string;
	engine: RemoteDatabaseBackup['engine'];
	database: string;
	path: string;
	bytes: number;
	sha256: string;
};

export type LifecycleWarning = {
	stage: 'post-backup' | 'cleanup';
	code: 'hook-failed' | 'hook-timeout' | 'hook-output-limit' | 'hook-invalid' | 'cleanup-failed';
};
