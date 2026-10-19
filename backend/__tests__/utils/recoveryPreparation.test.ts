import {
	manualRecoveryPolicy,
	recoveryMetadataToken,
	recoveryManualSelection,
} from '../../src/utils/recoveryPreparation';
import { recoveryArtifacts } from '../../src/utils/recoveryValidation';

const entry = {
	databaseId: 'db_example',
	engine: 'mariadb',
	database: 'example_db',
	path: '/pluton/database/example.sql',
	bytes: 10,
	sha256: 'c'.repeat(64),
};
const metadata = {
	planId: 'plan-01',
	backupId: 'backup-01',
	repositoryId: 'repo-01',
	snapshotId: 'a'.repeat(64),
	databases: recoveryArtifacts({ databases: [entry] }),
};
const request = {
	backupId: metadata.backupId,
	snapshotId: metadata.snapshotId,
	metadataToken: recoveryMetadataToken(metadata),
	resourcesAcknowledged: true,
	selection: { databaseImport: 'required', targetModes: { mariadb: 'custom' } },
};
describe('verified recovery confirmation boundary', () => {
	it('fingerprint binds every plan/repository/backup/snapshot/identity/engine/path/size/hash', () => {
		for (const changes of [
			{ planId: 'plan-other' },
			{ backupId: 'backup-other' },
			{ repositoryId: 'repo-other' },
			{ snapshotId: 'b'.repeat(64) },
		])
			expect(recoveryMetadataToken({ ...metadata, ...changes })).not.toBe(request.metadataToken);
		for (const changes of [
			{ databaseId: 'db_other' },
			{ engine: 'mysql' },
			{ database: 'other' },
			{ path: '/pluton/database/other.sql' },
			{ bytes: 11 },
			{ sha256: 'd'.repeat(64) },
		])
			expect(
				recoveryMetadataToken({
					...metadata,
					databases: recoveryArtifacts({ databases: [{ ...entry, ...changes }] }),
				})
			).not.toBe(request.metadataToken);
	});
	it('never enables automation, alters saved target modes or silently downgrades required imports', () => {
		const saved = {
			enabled: true,
			databaseImport: 'required' as const,
			targetModes: { mariadb: 'internal' as const },
		};
		const policy = manualRecoveryPolicy(saved, request, metadata.databases);
		expect(policy).toEqual({
			enabled: false,
			databaseImport: 'required',
			targetModes: { mariadb: 'custom' },
		});
		expect(saved.targetModes.mariadb).toBe('internal');
		expect(() =>
			manualRecoveryPolicy(
				saved,
				{ ...request, selection: { databaseImport: 'disabled' } },
				metadata.databases
			)
		).toThrow('requires native import');
	});
	it('rejects guessed engine, arbitrary endpoint, missing acknowledgement and invalid target mode', () => {
		for (const extra of [
			{ engine: 'postgresql' },
			{ host: 'source.example.internal' },
			{ resourcesAcknowledged: false },
			{ selection: { databaseImport: 'required', targetModes: { mysql: 'unapproved' } } },
		])
			expect(recoveryManualSelection.safeParse({ ...request, ...extra }).success).toBe(false);
	});
	it('historical single-DB artifacts stay artifact-only when engine/name is absent', () => {
		const historical = recoveryArtifacts({
			database: { path: entry.path, bytes: entry.bytes, sha256: entry.sha256 },
		});
		expect(() =>
			manualRecoveryPolicy({ enabled: false, databaseImport: 'disabled' }, request, historical)
		).toThrow('metadata is incomplete');
		expect(
			manualRecoveryPolicy(
				{ enabled: false, databaseImport: 'disabled' },
				{ ...request, selection: { databaseImport: 'disabled' } },
				historical
			).databaseImport
		).toBe('disabled');
	});
	it('two Internal engines cannot use one admission/activation; full multi-DB Custom remains supported', () => {
		const entries = recoveryArtifacts({
			databases: [
				entry,
				{
					...entry,
					engine: 'postgresql',
					databaseId: 'db_second',
					path: '/pluton/database/second.sql',
				},
			],
		});
		expect(() =>
			manualRecoveryPolicy(
				{ enabled: false, databaseImport: 'required' },
				{
					...request,
					selection: {
						databaseImport: 'required',
						targetModes: { mariadb: 'internal', postgresql: 'internal' },
					},
				},
				entries
			)
		).toThrow('Only one Internal engine');
		expect(() =>
			manualRecoveryPolicy({ enabled: false, databaseImport: 'required' }, request, entries)
		).not.toThrow();
	});
});
