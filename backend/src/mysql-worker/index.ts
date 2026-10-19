import { readFileSync } from 'fs';
import { assertRecoveryClientPath } from '../utils/recoveryDatabaseClients';
import { startMysqlWorker } from './server';
import { workerConfigSchema } from './protocol';

try {
	const config = workerConfigSchema.parse(
		JSON.parse(
			readFileSync(assertRecoveryClientPath('/run/pluton-mysql-config/target.json', false), 'utf8')
		)
	);
	// Internal-only workers have no static Custom target or CA; authority is
	// independently read from per-operation root proof, never from caller paths.
	const ca = config.host
		? assertRecoveryClientPath('/run/pluton-mysql-config/ca.pem', false)
		: undefined;
	const worker = await startMysqlWorker(config, () => {
		if (!ca) throw new Error('Custom trust not configured.');
		return ca;
	});
	for (const event of ['SIGTERM', 'SIGINT'] as const)
		process.once(event, () => {
			void worker.stop().finally(() => process.exit(0));
		});
} catch {
	process.stderr.write(
		'MySQL recovery worker startup refused; check private IPC, approved target, trust and native client configuration.\n'
	);
	process.exitCode = 1;
}
