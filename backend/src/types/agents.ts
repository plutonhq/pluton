import type { Request } from 'express';
import type { AgentCommandType } from '../db/schema/agents';

export const AGENT_COMMAND_TYPES: readonly AgentCommandType[] = [
	'PING',
	'INVENTORY_REFRESH',
	'BACKUP_FILESYSTEM',
];
export const AGENT_REQUEST_SKEW_MS = 5 * 60 * 1000;
export const AGENT_COMMAND_LEASE_MS = 60 * 1000;

export type AgentInventory = {
	hostname: string;
	os: string;
	architecture: string;
	agentVersion: string;
	resticVersion?: string;
	rcloneVersion?: string;
	uptimeSeconds?: number;
	capabilities: {
		filesystemRootsConfigured: boolean;
		commandTypes: AgentCommandType[];
		backupLifecycleVersion?: 1 | 2;
		databaseEngines?: ('mysql' | 'mariadb' | 'postgresql')[];
		hooksConfigured?: boolean;
	};
};

export type AuthenticatedAgent = {
	agentId: string;
	deviceId: string;
	secret: string;
};

export type AgentRequest = Request & {
	rawBody?: string;
	agent?: AuthenticatedAgent;
};
