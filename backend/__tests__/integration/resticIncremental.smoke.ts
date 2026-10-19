// Disposable native Restic 0.19.1 evidence; never accepts a production repository.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import * as fs from 'node:fs/promises';
import { compatibleResticParent, resticParentArgs } from '../../../agent/dist/resticParent.js';

const exec = promisify(execFile);
const restic = '/usr/local/bin/restic';
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'pluton-incremental-'));
const env = {
	PATH: '/usr/local/bin:/usr/bin:/bin',
	RESTIC_PASSWORD: crypto.randomBytes(32).toString('base64url'),
	RESTIC_CACHE_DIR: path.join(scratch, 'cache'),
};
async function run(repository: string, args: string[], cwd = scratch) {
	const result = await exec(restic, ['-r', repository, ...args], {
		cwd,
		env,
		maxBuffer: 4 * 1024 ** 2,
		timeout: 60_000,
	});
	return result.stdout;
}
function summary(output: string) {
	return output
		.split('\n')
		.filter(Boolean)
		.map(line => JSON.parse(line))
		.find(item => item.message_type === 'summary');
}
try {
	assert.match((await exec(restic, ['version'], { env })).stdout, /restic 0\.19\.1 /);
	const source = path.join(scratch, 'source', 'app-01');
	const repository = path.join(scratch, 'repository');
	await fs.mkdir(source, { recursive: true });
	await fs.writeFile(path.join(source, 'app.txt'), 'synthetic application content\n'.repeat(10000));
	await fs.writeFile(path.join(source, 'settings.txt'), 'synthetic settings\n');
	await run(repository, ['init']);
	const snapshots: string[] = [];
	const summaries: any[] = [];
	for (const name of ['job-before-a', 'job-before-b']) {
		const workspace = path.join(scratch, 'agent', 'jobs', name);
		await fs.mkdir(path.join(workspace, 'pluton', 'database'), { recursive: true });
		await fs.writeFile(
			path.join(workspace, 'pluton/database/app.sql'),
			'-- synthetic SQL artifact\n'
		);
		summaries.push(
			summary(
				await run(
					repository,
					[
						'backup',
						source,
						'pluton/database/app.sql',
						'--json',
						'--host',
						'app-01',
						'--tag',
						'pluton-plan-plan-01',
						'--tag',
						`pluton-backup-${name}`,
					],
					workspace
				)
			)
		);
		snapshots.push(summaries.at(-1).snapshot_id);
	}
	const metadata = JSON.parse(await run(repository, ['snapshots', '--json']));
	assert.equal(summaries[0].files_new, 3);
	assert.equal(summaries[1].files_new, 3);
	assert.equal(summaries[1].files_unmodified, 0);
	assert.equal(metadata.find((item: any) => item.id === snapshots[1]).parent, undefined);
	assert.notDeepEqual(metadata[0].paths, metadata[1].paths);
	assert.equal(
		summaries[1].data_blobs,
		0,
		'content deduplication remains effective without a parent'
	);
	const nodes = (await run(repository, ['ls', '--json', snapshots[1]]))
		.split('\n')
		.filter(Boolean)
		.map(line => JSON.parse(line));
	assert(nodes.some(node => node.path === '/pluton/database/app.sql'));
	assert.equal(
		await run(repository, ['dump', snapshots[1], path.join(source, 'app.txt')]),
		await fs.readFile(path.join(source, 'app.txt'), 'utf8')
	);
	console.log(
		'PASS native reproduction: random DB workspace changes snapshot metadata paths; no parent, all files new, content deduplication and snapshot layout intact.'
	);

	const jobsRoot = path.join(scratch, 'agent', 'jobs');
	let parent = compatibleResticParent(metadata, {
		successfulIds: snapshots,
		planId: 'plan-01',
		source,
		hostname: 'app-01',
		jobsRoot,
		artifacts: ['pluton/database/app.sql'],
	});
	assert.equal(
		parent,
		snapshots[1],
		'historical successful layout is compatible without rewriting it'
	);
	const workspace = path.join(jobsRoot, 'job-after-c');
	await fs.mkdir(path.join(workspace, 'pluton', 'database'), { recursive: true });
	await fs.writeFile(
		path.join(workspace, 'pluton/database/app.sql'),
		'-- changed synthetic SQL artifact\n'
	);
	const fixed = summary(
		await run(
			repository,
			[
				'backup',
				source,
				'pluton/database/app.sql',
				'--json',
				'--host',
				'app-01',
				'--tag',
				'pluton-plan-plan-01',
				'--tag',
				'pluton-backup-after-c',
				...resticParentArgs(parent),
			],
			workspace
		)
	);
	assert.equal(fixed.files_new, 0);
	assert.equal(fixed.files_changed, 1);
	assert.equal(fixed.files_unmodified, 2);
	const fixedMetadata = JSON.parse(
		await run(repository, ['snapshots', '--json', fixed.snapshot_id])
	)[0];
	assert.equal(fixedMetadata.parent, parent);
	assert(fixedMetadata.paths.includes(path.join(workspace, 'pluton/database/app.sql')));
	assert.equal(
		await run(repository, ['dump', fixed.snapshot_id, '/pluton/database/app.sql']),
		'-- changed synthetic SQL artifact\n'
	);
	console.log(
		'PASS native fix: verified historical parent; unchanged application files reused; changed DB artifact and original layout preserved.'
	);

	const fsRepository = path.join(scratch, 'filesystem-repository');
	await run(fsRepository, ['init']);
	const successful: string[] = [];
	let ordinal = 0;
	async function backupFs(hostname = 'app-01', backupSource = source, planId = 'plan-02') {
		const records = JSON.parse(await run(fsRepository, ['snapshots', '--json']));
		const selected = compatibleResticParent(records, {
			successfulIds: successful,
			planId,
			source: backupSource,
			hostname,
			jobsRoot,
			artifacts: [],
		});
		const result = summary(
			await run(fsRepository, [
				'backup',
				backupSource,
				'--json',
				'--host',
				hostname,
				'--tag',
				`pluton-plan-${planId}`,
				'--tag',
				`pluton-backup-fs-${++ordinal}`,
				...resticParentArgs(selected),
			])
		);
		const record = JSON.parse(
			await run(fsRepository, ['snapshots', '--json', result.snapshot_id])
		)[0];
		assert.equal(record.parent, selected);
		successful.push(result.snapshot_id);
		return result;
	}
	const first = await backupFs();
	assert.equal(first.files_new, 2);
	const second = await backupFs();
	assert.equal(second.files_new, 0);
	assert.equal(second.files_unmodified, 2);
	assert.equal(second.data_blobs, 0);
	console.log(
		'PASS native filesystem first/unchanged second backup; parent and JSON counters confirmed.'
	);
	await fs.appendFile(path.join(source, 'settings.txt'), 'one changed file\n');
	const third = await backupFs();
	assert.equal(third.files_changed, 1);
	assert.equal(third.files_unmodified, 1);
	await fs.writeFile(path.join(source, 'additional.txt'), 'additional synthetic file\n');
	const fourth = await backupFs();
	assert.equal(fourth.files_new, 1);
	assert.equal(fourth.files_unmodified, 2);
	console.log('PASS native one modified file / one added file.');
	await fs.chmod(path.join(source, 'additional.txt'), 0o640);
	const metadataOnly = await backupFs();
	assert.equal(metadataOnly.files_new, 0);
	assert.equal(metadataOnly.data_blobs, 0, 'metadata-only change does not store duplicate content');
	console.log('PASS native metadata-only change remains deduplicated.');
	const hostChange = await backupFs('app-02');
	assert.equal(hostChange.files_new, 3);
	assert.equal(hostChange.data_blobs, 0);
	const otherSource = path.join(scratch, 'source', 'app-02');
	await fs.cp(source, otherSource, { recursive: true });
	const pathChange = await backupFs('app-02', otherSource);
	assert.equal(pathChange.files_new, 3);
	assert.equal(pathChange.data_blobs, 0);
	const planChange = await backupFs('app-02', otherSource, 'plan-03');
	assert.equal(planChange.files_new, 3);
	const foreign = JSON.parse(await run(repository, ['snapshots', '--json']));
	assert.equal(
		compatibleResticParent(foreign, {
			successfulIds: successful,
			planId: 'plan-02',
			source,
			hostname: 'app-01',
			jobsRoot,
			artifacts: [],
		}),
		undefined
	);
	console.log(
		'PASS native hostname/path/plan/repository isolation; no implicit cross-plan parent fallback.'
	);
	const restored = path.join(scratch, 'restored');
	await run(fsRepository, ['restore', fourth.snapshot_id, '--target', restored]);
	for (const filename of ['app.txt', 'settings.txt', 'additional.txt'])
		assert.deepEqual(
			await fs.readFile(path.join(restored, source, filename)),
			await fs.readFile(path.join(source, filename))
		);
	const packed = fourth.data_added_packed;
	assert.equal(typeof packed, 'number');
	assert.equal(fourth.total_files_processed, 3);
	assert.equal(
		fourth.total_bytes_processed,
		(
			await Promise.all(
				['app.txt', 'settings.txt', 'additional.txt'].map(
					async file => (await fs.stat(path.join(source, file))).size
				)
			)
		).reduce((a, b) => a + b, 0)
	);
	console.log(
		'PASS native staged restore/content verification; logical byte totals and compressed-data counters are real Restic values.'
	);
} finally {
	await fs.rm(scratch, { recursive: true, force: true });
}
