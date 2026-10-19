import crypto from 'crypto';
import fs from 'fs/promises';
import { constants } from 'fs';
import type {
	DatabaseRestore,
	DatabaseRestoreInspection,
	PersistentTargetApproval,
} from '../types/databaseRestores';
import { RESTORE_PURPOSE } from '../types/databaseRestores';
import type { DatabaseRestoreStore } from '../stores/DatabaseRestoreStore';
import {
	RecoveryDatabaseImporter,
	assertRecoveryMysqlGrants,
	postgresRecoveryInput,
} from './recoveryDatabaseImport';
import { runRecoveryProcess } from './recoveryProcess';
import { detectRecoveryClient } from './recoveryDatabaseClients';
import { checkRecoveryDumpCompatibility } from './recoveryDumpCompatibility';
import { DatabaseRestoreError, restoreId, restoreDatabaseName } from './persistentRestorePolicy';
import { checkRecoveryCancellation } from './recoveryValidation';

const GUARD = 'pluton_restore_guard';
const OWNER = '__pluton_persistent_owner';
type Connection = Awaited<ReturnType<PersistentDatabaseImporter['open']>>;
/** Typed retained lifecycle, separate guard/owner/leases from disposable Phase 6.
 * Inherits only the tested credential-file/native-process connection boundary. */
export class PersistentDatabaseImporter extends RecoveryDatabaseImporter {
	constructor(
		private readonly persistent: Pick<
			DatabaseRestoreStore,
			'lease' | 'addLease' | 'leaseState' | 'removeLease'
		>,
		private readonly approval: PersistentTargetApproval,
		ca: string,
		run = runRecoveryProcess,
		client = detectRecoveryClient
	) {
		const refuse = async () => {
			throw new DatabaseRestoreError('wrong-operation-purpose');
		};
		super(
			{ leases: refuse, leaseTarget: refuse, addLease: refuse, removeLease: refuse },
			run,
			client,
			() => ca
		);
	}
	protected open(directory: string, signal: AbortSignal) {
		return this.connection(this.approval.target, directory, signal);
	}
	private pg() {
		return this.approval.engine === 'postgresql';
	}
	private validateRow(row: DatabaseRestore) {
		const binding = this.approval.binding;
		if (
			row.purpose !== RESTORE_PURPOSE ||
			row.targetId !== this.approval.id ||
			row.mode !== this.approval.mode ||
			!restoreId.safeParse(row.id).success ||
			!/^[a-f0-9]{48}$/.test(row.ownerToken) ||
			!/^[a-f0-9]{64}$/.test(row.snapshotId) ||
			!/^[a-f0-9]{64}$/.test(row.artifact.sha256) ||
			!restoreDatabaseName.safeParse(row.artifact.database).success ||
			row.artifact.engine !== this.approval.engine ||
			row.artifact.database !== this.approval.database ||
			this.approval.target.engine !== this.approval.engine ||
			(row.mode === 'internal' &&
				(binding?.restoreId !== row.id ||
					binding.snapshotId !== row.snapshotId ||
					binding.sha256 !== row.artifact.sha256))
		)
			throw new DatabaseRestoreError('target-binding-mismatch');
	}
	private ownedLease(row: DatabaseRestore) {
		const lease = this.persistent.lease(row.id);
		if (
			lease &&
			(lease.restoreId !== row.id ||
				lease.targetId !== row.targetId ||
				lease.ownerToken !== row.ownerToken ||
				lease.database !== (this.pg() ? `pdr_${row.id}` : this.approval.database))
		)
			throw new DatabaseRestoreError('restore-ownership-uncertain');
		return lease;
	}
	private async guard(connection: Connection) {
		const result = await connection.query(
			GUARD,
			'SELECT purpose,activation_id,storage_id FROM contract;',
			'database-target-preflight'
		);
		const parts = result.trim().split(/[|\t]/);
		if (
			parts.length !== 3 ||
			parts[0] !== RESTORE_PURPOSE ||
			parts[1] !== this.approval.activationId ||
			parts[2] !== this.approval.storage.id
		)
			throw new DatabaseRestoreError('restore-purpose-guard-mismatch');
		if (this.approval.engine === 'mysql') {
			const version = await connection.query('', 'SELECT VERSION();', 'database-target-preflight');
			const vendor = await connection.query(
				'',
				'SELECT @@version_comment;',
				'database-target-preflight'
			);
			if (
				!/^8\.4\.\d+(?:\D|$)/.test(version.trim()) ||
				!/^MySQL Community Server\b/.test(vendor.trim())
			)
				throw new DatabaseRestoreError('database-client-incompatible');
		}
		if (this.pg()) {
			const unsafe = await connection.query(
				'postgres',
				'SELECT count(*) FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolcreaterole OR rolreplication OR rolbypassrls); SELECT count(*) FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=current_user);',
				'database-target-preflight'
			);
			if (unsafe.trim() !== '0\n0') throw new DatabaseRestoreError('target-privileges-unsafe');
		} else
			assertRecoveryMysqlGrants(
				await connection.query('', 'SHOW GRANTS;', 'database-target-preflight'),
				[this.approval.database],
				'persistent'
			);
	}
	private async catalog(connection: Connection) {
		return (
			await connection.query(
				this.pg() ? 'postgres' : '',
				this.pg() ? 'SELECT datname FROM pg_database;' : 'SHOW DATABASES;',
				'database-target-preflight'
			)
		)
			.trim()
			.split(/\r?\n/)
			.filter(Boolean);
	}
	private async exclusive(connection: Connection, database?: string) {
		const system = this.pg()
			? ['postgres', 'template0', 'template1', GUARD]
			: ['mysql', 'information_schema', 'performance_schema', 'sys', GUARD];
		const names = await this.catalog(connection);
		if (names.some(name => !system.includes(name) && name !== database))
			throw new DatabaseRestoreError('target-catalog-not-dedicated');
		return names;
	}
	private async assertOwner(connection: Connection, row: DatabaseRestore, database: string) {
		const result = (
			await connection.query(
				database,
				`SELECT restore_id,snapshot_id,artifact_sha256,owner_token,purpose FROM ${OWNER};`,
				'database-import-validation'
			)
		)
			.trim()
			.split(/[|\t]/);
		if (
			result.length !== 5 ||
			result.join('|') !==
				[row.id, row.snapshotId, row.artifact.sha256, row.ownerToken, RESTORE_PURPOSE].join('|')
		)
			throw new DatabaseRestoreError('restore-ownership-uncertain');
	}
	async restore(
		row: DatabaseRestore,
		file: string,
		directory: string,
		signal: AbortSignal,
		stage: (value: string) => void
	) {
		if (
			row.artifact.engine !== this.approval.engine ||
			row.artifact.database !== this.approval.database ||
			row.artifact.artifactValidation !== 'passed'
		)
			throw new DatabaseRestoreError('database-engine-or-artifact-mismatch');
		this.validateRow(row);
		const connection = await this.open(directory, signal);
		let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
		try {
			handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
			const stat = await handle.stat(),
				hash = crypto.createHash('sha256');
			if (!stat.isFile() || stat.size !== row.artifact.bytes)
				throw new DatabaseRestoreError('database-artifact-size-mismatch');
			for await (const chunk of handle.createReadStream({ autoClose: false, start: 0 })) {
				checkRecoveryCancellation(signal);
				hash.update(chunk);
			}
			if (hash.digest('hex') !== row.artifact.sha256)
				throw new DatabaseRestoreError('database-artifact-hash-mismatch');
			stage('database-target-preflight');
			await this.guard(connection);
			const version = await connection.query(
				this.pg() ? 'postgres' : '',
				this.pg() ? 'SHOW server_version;' : 'SELECT VERSION();',
				'database-target-preflight'
			);
			await checkRecoveryDumpCompatibility(this.approval.engine, file, version);
			const database = this.pg() ? `pdr_${row.id}` : this.approval.database;
			const names = await this.exclusive(connection, database);
			if (names.includes(database)) throw new DatabaseRestoreError('database-already-exists');
			checkRecoveryCancellation(signal);
			await this.persistent.addLease({
				restoreId: row.id,
				targetId: row.targetId,
				database,
				ownerToken: row.ownerToken,
				state: 'intended',
			});
			const identifier = this.pg() ? `"${database}"` : '`' + database + '`';
			await connection.query(
				this.pg() ? 'postgres' : '',
				`CREATE DATABASE ${identifier};`,
				'database-target-preflight'
			);
			await this.persistent.leaseState(row.id, 'created');
			await connection.query(
				database,
				`CREATE TABLE ${OWNER} (restore_id VARCHAR(24) NOT NULL,snapshot_id VARCHAR(64) NOT NULL,artifact_sha256 VARCHAR(64) NOT NULL,owner_token VARCHAR(48) NOT NULL,purpose VARCHAR(64) NOT NULL);
				INSERT INTO ${OWNER} VALUES ('${row.id}','${row.snapshotId}','${row.artifact.sha256}','${row.ownerToken}','${RESTORE_PURPOSE}');`,
				'database-target-preflight'
			);
			stage('database-import');
			const stream = this.pg()
				? await postgresRecoveryInput(file)
				: handle.createReadStream({ start: 0, autoClose: false });
			try {
				await connection.query(database, stream, 'database-import', false, 60 * 60_000);
			} finally {
				stream.destroy();
			}
			stage('database-import-validation');
			await this.assertOwner(connection, row, database);
			await this.exclusive(connection, database);
			const inspection = await this.metadata(connection, database);
			await this.persistent.leaseState(row.id, 'validated');
			return inspection;
		} finally {
			await handle?.close();
			await connection.close();
		}
	}
	private async metadata(
		connection: Connection,
		database: string
	): Promise<DatabaseRestoreInspection> {
		const version = (
			await connection.query(
				database,
				this.pg() ? 'SHOW server_version;' : 'SELECT VERSION();',
				'database-import-validation'
			)
		).match(/\d+\.\d+(?:\.\d+)?/)?.[0];
		if (!version) throw new DatabaseRestoreError('database-version-unavailable');
		const output = await connection.query(
			database,
			this.pg()
				? `SELECT json_build_object('schema',table_schema,'name',table_name,'type',table_type)::text FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') AND table_name<>'${OWNER}' ORDER BY table_schema,table_name LIMIT 201;`
				: `SELECT JSON_OBJECT('schema',TABLE_SCHEMA,'name',TABLE_NAME,'type',TABLE_TYPE) FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME<>'${OWNER}' ORDER BY TABLE_NAME LIMIT 201;`,
			'database-import-validation'
		);
		const catalog = output.trim()
			? output
					.trim()
					.split(/\r?\n/)
					.map(line => {
						const value = JSON.parse(line) as { schema: string; name: string; type: string };
						if (
							Object.keys(value).sort().join(',') !== 'name,schema,type' ||
							[value.schema, value.name, value.type].some(
								v => typeof v !== 'string' || v.length > 256 || /[\0\r\n]/.test(v)
							)
						)
							throw new DatabaseRestoreError('inspection-output-invalid');
						return value;
					})
			: [];
		const counts = (
			await connection.query(
				database,
				this.pg()
					? `SELECT count(*) FILTER (WHERE table_type='BASE TABLE'),count(*) FILTER (WHERE table_type='VIEW') FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') AND table_name<>'${OWNER}';`
					: `SELECT COALESCE(SUM(TABLE_TYPE='BASE TABLE'),0),COALESCE(SUM(TABLE_TYPE='VIEW'),0) FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME<>'${OWNER}';`,
				'database-import-validation'
			)
		).trim();
		const parsed = /^(\d+)[|\t](\d+)$/.exec(counts);
		if (!parsed) throw new DatabaseRestoreError('inspection-output-invalid');
		const bytes = (
			await connection.query(
				database,
				this.pg()
					? 'SELECT pg_database_size(current_database());'
					: `SELECT COALESCE(SUM(DATA_LENGTH+INDEX_LENGTH),0) FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE();`,
				'database-import-validation'
			)
		).trim();
		return {
			engine: this.approval.engine,
			version,
			database,
			catalog: catalog.slice(0, 200),
			catalogTruncated: catalog.length > 200,
			tables: Number(parsed[1]),
			views: Number(parsed[2]),
			bytes: /^\d+$/.test(bytes) ? Number(bytes) : null,
			observedAt: Date.now(),
		};
	}
	async inspect(row: DatabaseRestore, directory: string, signal = new AbortController().signal) {
		this.validateRow(row);
		if (row.expiresAt <= Date.now() || row.cancelRequested)
			throw new DatabaseRestoreError('restore-access-not-active');
		const lease = this.ownedLease(row);
		if (!lease || lease.state !== 'validated')
			throw new DatabaseRestoreError('restore-ownership-uncertain');
		const connection = await this.open(directory, signal);
		try {
			await this.guard(connection);
			await this.assertOwner(connection, row, lease.database);
			await this.exclusive(connection, lease.database);
			return await this.metadata(connection, lease.database);
		} finally {
			await connection.close();
		}
	}
	async removeOwned(row: DatabaseRestore, directory: string) {
		this.validateRow(row);
		const lease = this.ownedLease(row);
		const connection = await this.open(directory, new AbortController().signal);
		try {
			await this.guard(connection);
			const names = await this.exclusive(connection, lease?.database);
			if (lease && names.includes(lease.database)) {
				await this.assertOwner(connection, row, lease.database);
				if (this.pg()) {
					if (lease.database !== `pdr_${row.id}`)
						throw new DatabaseRestoreError('restore-ownership-uncertain');
					const stopped = (
						await connection.query(
							'postgres',
							`SELECT pg_terminate_backend(pid,5000) FROM pg_stat_activity WHERE datname='${lease.database}' AND usename=current_user AND backend_type='client backend' AND pid<>pg_backend_pid();`,
							'database-cleanup'
						)
					).trim();
					if (stopped && stopped.split(/\r?\n/).some(value => value !== 't'))
						throw new DatabaseRestoreError('database-cleanup-failed');
					await this.assertOwner(connection, row, lease.database);
				}
				const identifier = this.pg() ? `"${lease.database}"` : '`' + lease.database + '`';
				await connection.query(
					this.pg() ? 'postgres' : '',
					`DROP DATABASE ${identifier};`,
					'database-cleanup'
				);
				if ((await this.catalog(connection)).includes(lease.database))
					throw new DatabaseRestoreError('database-cleanup-failed');
			}
			await this.persistent.removeLease(row.id);
			return true;
		} finally {
			await connection.close();
		}
	}
}
