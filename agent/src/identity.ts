import path from 'node:path';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import type { StoredAgentIdentity } from './types.js';

const IDENTITY_FILE = 'identity.json';

export function identityPath(dataDir: string): string {
	return path.join(dataDir, IDENTITY_FILE);
}

async function protect(pathname: string, mode: number): Promise<void> {
	try {
		await chmod(pathname, mode);
	} catch {
		// Windows does not implement POSIX modes. Linux deployments are checked by chmod.
	}
}

export async function saveIdentity(dataDir: string, identity: StoredAgentIdentity): Promise<void> {
	await mkdir(dataDir, { recursive: true, mode: 0o700 });
	await protect(dataDir, 0o700);
	const destination = identityPath(dataDir);
	const temporary = `${destination}.${process.pid}.tmp`;
	await writeFile(temporary, `${JSON.stringify(identity)}\n`, { encoding: 'utf8', mode: 0o600 });
	await protect(temporary, 0o600);
	await rename(temporary, destination);
	await protect(destination, 0o600);
}

export async function loadIdentity(dataDir: string): Promise<StoredAgentIdentity> {
	const raw = await readFile(identityPath(dataDir), 'utf8');
	const parsed = JSON.parse(raw) as Partial<StoredAgentIdentity>;
	if (
		!parsed.deviceId ||
		!parsed.agentId ||
		!parsed.secret ||
		!Number.isInteger(parsed.pollIntervalSeconds) ||
		!Array.isArray(parsed.completedCommands)
	) {
		throw new Error('Agent identity file is invalid. Re-enroll this agent.');
	}
	return parsed as StoredAgentIdentity;
}
