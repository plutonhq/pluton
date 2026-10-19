import fs from 'fs/promises';
import { constants } from 'fs';
import crypto from 'crypto';
import path from 'path';
import type { DatabaseRestore, PersistentTargetApproval } from '../types/databaseRestores';
import { RESTORE_PURPOSE } from '../types/databaseRestores';
import {
	persistentApprovalSchema,
	restoreId,
	DatabaseRestoreError,
} from './persistentRestorePolicy';
import { approvalFingerprint } from '../stores/DatabaseRestoreStore';
import { InternalRecoveryTargets, internalResourceReason } from './internalRecoveryTargets';
import { AutomaticRecoveryLifecycle, isReadonlyRecoveryMount } from './automaticRecoveryLifecycle';

export const PERSISTENT_PUBLIC = '/run/pluton-persistent-restores';
export const PERSISTENT_REQUESTS = '/run/pluton-persistent-restore-requests';
export const PERSISTENT_STORAGE = '/run/pluton-persistent-storage';
/** Root approvals are never UI-controlled connection settings or a Docker API. */
export class PersistentRestoreTargets {
	private readonly resources: InternalRecoveryTargets;
	constructor(
		private readonly root = PERSISTENT_PUBLIC,
		private readonly requests = PERSISTENT_REQUESTS,
		private readonly storage = PERSISTENT_STORAGE,
		resources?: InternalRecoveryTargets,
		readonly automatic?: AutomaticRecoveryLifecycle
	) { this.resources = resources || new InternalRecoveryTargets(undefined, undefined, automatic); }
	async policy() {
		try {
			const value = JSON.parse(
				(await this.trustedFile(path.join(this.root, 'policy.json'), 2048)).toString('utf8')
			);
			if (
				Object.keys(value).sort().join(',') !== 'maxRetentionSeconds,maxSqlBytes' ||
				!Number.isSafeInteger(value.maxSqlBytes) ||
				value.maxSqlBytes < 1 ||
				value.maxSqlBytes > 448 * 1024 ** 2 ||
				!Number.isSafeInteger(value.maxRetentionSeconds) ||
				value.maxRetentionSeconds < 86400 ||
				value.maxRetentionSeconds > 30 * 86400
			)
				throw new DatabaseRestoreError('operator-policy-unsafe');
			return value as { maxSqlBytes: number; maxRetentionSeconds: number };
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
			return { maxSqlBytes: 128 * 1024 ** 2, maxRetentionSeconds: 86400 };
		}
	}
	async verifiedAbsent(row: DatabaseRestore) {
		if (this.automatic?.record(row.id))
			return (await this.automatic.receipt(row.id))?.state === 'removed';
		try {
			const receipt = JSON.parse(
				(await this.trustedFile(path.join(this.root, `${row.id}.absent.json`), 4096)).toString(
					'utf8'
				)
			);
			return (
				receipt.purpose === RESTORE_PURPOSE &&
				receipt.restoreId === row.id &&
				receipt.snapshotId === row.snapshotId &&
				receipt.sha256 === row.artifact.sha256 &&
				receipt.state === 'never-provisioned' &&
				Number.isSafeInteger(receipt.observedAt)
			);
		} catch {
			return false;
		}
	}
	private async trustedFile(file: string, maxBytes = 65536, publicData = false) {
		if (process.platform !== 'linux' || process.getuid?.() !== 10001)
			throw new DatabaseRestoreError('operator-target-unavailable');
		for (let directory = path.dirname(file); ; directory = path.dirname(directory)) {
			const stat = await fs.lstat(directory);
			if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 || stat.mode & 0o022)
				throw new DatabaseRestoreError('operator-approval-unsafe');
			if (directory === path.dirname(directory)) break;
		}
		const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
		try {
			const stat = await handle.stat();
			if (
				!stat.isFile() ||
				stat.uid !== 0 ||
				stat.mode & (publicData ? 0o022 : 0o027) ||
				stat.size > maxBytes
			)
				throw new DatabaseRestoreError('operator-approval-unsafe');
			return await handle.readFile();
		} finally {
			await handle.close();
		}
	}
	async read(id: string): Promise<PersistentTargetApproval> {
		if (!restoreId.safeParse(id).success) throw new DatabaseRestoreError('target-binding-mismatch');
		try {
			const result = persistentApprovalSchema.safeParse(
				JSON.parse((await this.trustedFile(path.join(this.root, `${id}.json`))).toString('utf8'))
			);
			if (!result.success || result.data.id !== id) throw new Error();
			return result.data as PersistentTargetApproval;
		} catch (error) {
			if (error instanceof DatabaseRestoreError) throw error;
			throw new DatabaseRestoreError('operator-target-unavailable');
		}
	}
	async ca(approval: PersistentTargetApproval) {
		const file = path.join(this.root, `${approval.id}-ca.pem`);
		const bytes = await this.trustedFile(file, 16384);
		if (crypto.createHash('sha256').update(bytes).digest('hex') !== approval.caSha256)
			throw new DatabaseRestoreError('target-tls-binding-mismatch');
		return file;
	}
	async assertBinding(row: DatabaseRestore, stored?: PersistentTargetApproval) {
		const approval = await this.read(row.targetId);
		if (
			approval.mode !== row.mode ||
			approval.engine !== row.artifact.engine ||
			approval.database !== row.artifact.database ||
			(row.targetFingerprint && approvalFingerprint(approval) !== row.targetFingerprint) ||
			(stored && approvalFingerprint(stored) !== approvalFingerprint(approval)) ||
			(approval.mode === 'internal' &&
				(approval.binding?.restoreId !== row.id ||
					approval.binding.snapshotId !== row.snapshotId ||
					approval.binding.sha256 !== row.artifact.sha256 ||
					approval.target.host !== `persistent-db-${row.id}`))
		)
			throw new DatabaseRestoreError('target-binding-mismatch');
		await this.ca(approval);
		return approval;
	}
	async list() {
		try {
			const files = (await fs.readdir(this.root)).filter(file => /^[a-f0-9]{24}\.json$/.test(file));
			if (files.length > 64) throw new DatabaseRestoreError('operator-approval-unsafe');
			const targets = [];
			for (const file of files) {
				const approval = await this.read(file.slice(0, 24));
				if (approval.mode === 'custom')
					targets.push({
						id: approval.id,
						engine: approval.engine,
						database: approval.database,
						mode: approval.mode,
						maxRetentionSeconds: approval.maxRetentionSeconds,
						maxSqlBytes: approval.maxSqlBytes,
						quotaBytes: approval.storage.quotaBytes,
					});
			}
			return targets;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
			throw error;
		}
	}
	async admission(approval: PersistentTargetApproval, row: DatabaseRestore, directory: string) {
		const measured = await this.resources.resourceView(directory);
		if (row.mode === 'internal' && row.artifact.engine === 'mysql' && !measured.sample?.operatorObservedAt)
			throw new DatabaseRestoreError('resource-capacity-unknown');
		const reason = measured.sample
			? internalResourceReason(
					measured.sample,
					row.artifact.bytes,
					row.mode === 'internal' && approval.engine === 'mysql'
						? Math.min(approval.maxSqlBytes, 128 * 1024 ** 2)
						: approval.maxSqlBytes,
					row.mode === 'internal' ? approval.engine : undefined
				)
			: 'capacity-unknown';
		if (reason) throw new DatabaseRestoreError(`resource-${reason}`);
		if (row.ttlSeconds > approval.maxRetentionSeconds)
			throw new DatabaseRestoreError('retention-not-approved');
		if (row.artifact.bytes * 4 + 256 * 1024 ** 2 > approval.storage.quotaBytes)
			throw new DatabaseRestoreError('persistent-storage-quota-insufficient');
		if (approval.mode === 'internal') {
			const directory = path.join(this.storage, row.id);
			if (this.automatic?.record(row.id)) {
				let mountinfo: string;
				try {
					mountinfo = await fs.readFile('/proc/self/mountinfo', 'utf8');
				} catch {
					throw new DatabaseRestoreError('persistent-storage-not-mounted');
				}
				if (!isReadonlyRecoveryMount(mountinfo, directory))
					throw new DatabaseRestoreError('persistent-storage-not-mounted');
			}
			const stat = await fs.lstat(directory),
				parent = await fs.stat(this.storage);
			if (
				!stat.isDirectory() ||
				stat.isSymbolicLink() ||
				stat.uid !== 0 ||
				stat.mode & 0o022 ||
				stat.dev === parent.dev ||
				(await fs.realpath(directory)) !== directory
			)
				throw new DatabaseRestoreError('persistent-storage-not-mounted');
			const anchor = JSON.parse(
				(await this.trustedFile(path.join(directory, 'identity.json'), 4096, true)).toString('utf8')
			);
			if (
				anchor.restoreId !== row.id ||
				anchor.storageId !== approval.storage.id ||
				anchor.activationId !== approval.activationId
			)
				throw new DatabaseRestoreError('persistent-storage-ownership-mismatch');
			const disk = await fs.statfs(directory);
			if (
				disk.type !== 0xef53 ||
				disk.blocks * disk.bsize > approval.storage.quotaBytes ||
				disk.bavail * disk.bsize < row.artifact.bytes * 4 + 256 * 1024 ** 2
			)
				throw new DatabaseRestoreError('persistent-storage-quota-insufficient');
		}
	}
	resourceView(directory: string) {
		return this.resources.resourceView(directory);
	}
	async state(approval: PersistentTargetApproval) {
		if (approval.mode === 'custom') return { state: 'external' as const, observedAt: 0 };
		try {
			const state = JSON.parse(
				(await this.trustedFile(path.join(this.root, `${approval.id}.state.json`), 4096)).toString(
					'utf8'
				)
			);
			if (
				state.purpose !== RESTORE_PURPOSE ||
				state.restoreId !== approval.binding?.restoreId ||
				state.snapshotId !== approval.binding?.snapshotId ||
				state.activationId !== approval.activationId ||
				state.storageId !== approval.storage.id ||
				state.containerId !== approval.containerId ||
				!['active', 'stopped', 'removed'].includes(state.state) ||
				!Number.isSafeInteger(state.observedAt)
			)
				throw new Error();
			return state as { state: 'active' | 'stopped' | 'removed'; observedAt: number };
		} catch {
			throw new DatabaseRestoreError('operator-state-unverified');
		}
	}
	async request(
		row: DatabaseRestore,
		action: 'provision' | 'stop' | 'resume' | 'delete',
		cleanupReady = false
	) {
		if (
			this.automatic &&
			row.mode === 'internal' &&
			(this.automatic.record(row.id) || row.stage === 'checking-resources')
		) {
			await this.automatic.persistent(row, action, cleanupReady);
			return;
		}
		const stat = await fs.lstat(this.requests);
		if (
			!stat.isDirectory() ||
			stat.isSymbolicLink() ||
			stat.uid !== 10001 ||
			(stat.mode & 0o777) !== 0o700
		)
			throw new DatabaseRestoreError('operator-request-directory-unavailable');
		const request = {
			version: 1,
			purpose: RESTORE_PURPOSE,
			mode: row.mode,
			action,
			restoreId: row.id,
			snapshotId: row.snapshotId,
			databaseId: row.databaseId,
			engine: row.artifact.engine,
			database: row.artifact.database,
			sha256: row.artifact.sha256,
			bytes: row.artifact.bytes,
			expiresAt: row.expiresAt,
			cleanupReady,
			targetFingerprint: row.targetFingerprint,
		};
		const temporary = path.join(this.requests, `${crypto.randomBytes(12).toString('hex')}.tmp`);
		try {
			await fs.writeFile(temporary, JSON.stringify(request), { mode: 0o600, flag: 'wx' });
			await fs.rename(temporary, path.join(this.requests, `${row.id}.json`));
		} finally {
			await fs.rm(temporary, { force: true });
		}
	}
}
