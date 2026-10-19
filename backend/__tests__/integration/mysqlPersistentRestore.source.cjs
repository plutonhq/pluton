// Synthetic source metadata only; never connects to a repository or a source Agent.
function seedMysqlPersistentSource(sqlite, metadata) {
	sqlite.transaction(() => {
		sqlite.exec(`INSERT INTO storages(id,name,type) VALUES('storage-01','Fixture SFTP','sftp');
			INSERT INTO devices(id,name) VALUES('app-01','Fixture');
			INSERT INTO agent_identities(agent_id,device_id,encrypted_secret,hostname,os,architecture,agent_version,capabilities)
			VALUES('agent-01','app-01','synthetic-cipher','app-01','Linux','x86_64','0.4.0','{}');`);
		sqlite
			.prepare(
				`INSERT INTO plans(id,title,source_id,source_type,method,storage_id,storage_path,source_config,settings)
			VALUES(?,'Fixture','app-01','device','backup','storage-01','managed/fixture','{}','{}')`
			)
			.run(metadata.planId);
		sqlite
			.prepare(
				`INSERT INTO backups(id,plan_id,source_id,source_type,method,storage_id,storage_path,status,in_progress,success,completion_stats)
			VALUES(?,?,'app-01','device','backup','storage-01','managed/fixture','completed',0,1,?)`
			)
			.run(
				metadata.backupId,
				metadata.planId,
				JSON.stringify({ snapshot_id: metadata.snapshotId })
			);
		sqlite
			.prepare(
				`INSERT INTO remote_managed_repositories(id,plan_id,agent_id,storage_id,storage_path,encrypted_password,initialized_at)
			VALUES(?,?,'agent-01','storage-01','managed/fixture','synthetic-cipher',1)`
			)
			.run(metadata.repositoryId, metadata.planId);
	})();
}

// Log bounded machine fields only, never error messages, SQL, target details or credentials.
function admissionDiagnostic(error) {
	const code =
		typeof error?.code === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(error.code)
			? error.code
			: 'unclassified';
	const status =
		Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode <= 599
			? error.statusCode
			: 'unknown';
	return `decision=refused code=${code} status=${status}`;
}

module.exports = { seedMysqlPersistentSource, admissionDiagnostic };
