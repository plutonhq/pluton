export type AgentCommandType =
  | "PING"
  | "INVENTORY_REFRESH"
  | "BACKUP_FILESYSTEM";

export type AgentCapabilities = {
  filesystemRootsConfigured: boolean;
  commandTypes: AgentCommandType[];
  backupLifecycleVersion?: 1 | 2;
  databaseEngines?: ("mysql" | "mariadb" | "postgresql")[];
  hooksConfigured?: boolean;
};

export type AgentInventory = {
  hostname: string;
  os: string;
  architecture: string;
  agentVersion: string;
  resticVersion?: string;
  rcloneVersion?: string;
  uptimeSeconds?: number;
  capabilities: AgentCapabilities;
};

export type StoredCommandCompletion = {
  commandId: string;
  sequence: number;
  success: boolean;
  error?: string;
  /** Closed, non-secret diagnostics for BACKUP_FILESYSTEM failures. */
  failureStage?: string;
  failureCode?: string;
  databaseId?: string;
  engine?: "mysql" | "mariadb" | "postgresql";
  /** A bounded, non-secret execution result such as a Restic snapshot ID. */
  result?: Record<string, unknown>;
  cancelled?: boolean;
};

export type StoredAgentIdentity = {
  deviceId: string;
  agentId: string;
  secret: string;
  pollIntervalSeconds: number;
  completedCommands: StoredCommandCompletion[];
};

export type AgentConfig = {
  serverUrl: URL;
  dataDir: string;
  allowedRoots: string[];
  /** Private installer-owned binaries. Never resolve Restic/Rclone from host PATH. */
  binDir?: string;
  /** Administrator-only local configuration; never supplied by a command. */
  hookRoot?: string;
  databaseBinDirs?: string[];
  allowInsecureHttp: boolean;
  caFile?: string;
  clientCertFile?: string;
  clientKeyFile?: string;
};

export type AgentCommandEnvelope = {
  id: string;
  type: AgentCommandType;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  leaseExpiresAt: string | null;
  leaseToken: string;
  signatureTimestamp: string;
  signature: string;
};
