import path from 'path';
import { z } from 'zod';
import { RestoreOptions } from '../../types/restores';
import { appPaths } from '../AppPaths';
import { generateResticRepoPath } from './helpers';

const performanceSettingsSchema = z
	.object({
		maxProcessor: z.number().int().nonnegative().optional(),
		transfers: z.number().int().nonnegative().optional(),
		bufferSize: z.string().min(1).optional(),
		multiThreadStream: z.number().int().nonnegative().optional(),
	})
	.partial();

const restoreRequestSchema = z.object({
	backupId: z.string().min(1),
	snapshotId: z.string().min(1),
	repoPath: z.string().min(1),
	repoPassword: z.string(),
	encryption: z.boolean(),
	target: z.string().min(1),
	overwrite: z.enum(['always', 'if-changed', 'if-newer', 'never']),
	includes: z.array(z.string().min(1)),
	excludes: z.array(z.string().min(1)),
	delete: z.boolean(),
	dryRun: z.boolean(),
	performanceSettings: performanceSettingsSchema.optional(),
	sources: z.array(z.string().min(1)).optional(),
});

export type NormalizedRestoreRequest = z.infer<typeof restoreRequestSchema>;

export function createNormalizedRestoreRequest(
	backupId: string,
	snapshotId: string,
	options: RestoreOptions,
	repoPassword: string,
	dryRun: boolean = false,
	platform: NodeJS.Platform = process.platform
): NormalizedRestoreRequest {
	const repoPath = generateResticRepoPath(options.storageName, options.storagePath || '');
	let target = options.target || '/';

	if (target === '/' && platform === 'win32') {
		target = path.join(appPaths.getRestoresDir(), `backup-${backupId}`);
	}

	return restoreRequestSchema.parse({
		backupId,
		snapshotId,
		repoPath,
		repoPassword,
		encryption: options.encryption,
		target,
		sources: options.sources || [],
		overwrite: options.overwrite || 'always',
		includes: options.includes || [],
		excludes: options.excludes || [],
		delete: options.delete || false,
		dryRun,
		performanceSettings: options.performanceSettings,
	});
}

export function buildResticRestoreCommand(request: NormalizedRestoreRequest): {
	args: string[];
	env: Record<string, string>;
} {
	const overwriteArgs = request.overwrite === 'always' ? [] : ['--overwrite', request.overwrite];
	const resticArgs = [
		'restore',
		'-r',
		request.repoPath,
		request.snapshotId,
		'--target',
		request.target,
		...overwriteArgs,
		'--verbose=2',
		'--json',
	];

	for (const item of request.includes) {
		resticArgs.push('--include', item);
	}
	for (const item of request.excludes) {
		resticArgs.push('--exclude', item);
	}
	if (request.delete) {
		resticArgs.push('--delete');
	}
	if (!request.encryption) {
		resticArgs.push('--insecure-no-password');
	}
	if (request.dryRun) {
		resticArgs.push('--dry-run');
	}

	const env: Record<string, string> = {
		RESTIC_PASSWORD: request.repoPassword,
	};
	if (request.performanceSettings?.maxProcessor) {
		env.GOMAXPROCS = request.performanceSettings.maxProcessor.toString();
	}
	if (request.performanceSettings?.transfers) {
		env.RCLONE_TRANSFERS = request.performanceSettings.transfers.toString();
	}
	if (request.performanceSettings?.bufferSize) {
		env.RCLONE_BUFFER_SIZE = request.performanceSettings.bufferSize;
	}
	if (request.performanceSettings?.multiThreadStream) {
		env.RCLONE_MULTI_THREAD_STREAMS = request.performanceSettings.multiThreadStream.toString();
	}

	return { args: resticArgs, env };
}

export function buildHelperRestoreArgs(request: NormalizedRestoreRequest): string[] {
	const helperArgs = [
		'restore',
		'--repo',
		request.repoPath,
		'--snapshot',
		request.snapshotId,
		'--target',
		request.target,
	];

	if (
		(request.target === '/' || !request.target) &&
		request.includes.length === 0 &&
		request.sources &&
		request.sources.length > 0
	) {
		for (const item of request.sources) {
			helperArgs.push('--include', item);
		}
	}

	if (request.overwrite !== 'always') {
		helperArgs.push('--overwrite', request.overwrite);
	}
	for (const item of request.includes) {
		helperArgs.push('--include', item);
	}
	for (const item of request.excludes) {
		helperArgs.push('--exclude', item);
	}
	if (request.delete) {
		helperArgs.push('--delete');
	}
	if (!request.encryption) {
		helperArgs.push('--insecure-no-password');
	}
	if (request.dryRun) {
		helperArgs.push('--dry-run');
	}
	if (request.performanceSettings?.maxProcessor) {
		helperArgs.push('--gomaxprocs', request.performanceSettings.maxProcessor.toString());
	}
	if (request.performanceSettings?.transfers) {
		helperArgs.push('--rclone-transfers', request.performanceSettings.transfers.toString());
	}
	if (request.performanceSettings?.bufferSize) {
		helperArgs.push('--rclone-buffer-size', request.performanceSettings.bufferSize);
	}
	if (request.performanceSettings?.multiThreadStream) {
		helperArgs.push(
			'--rclone-multi-thread-streams',
			request.performanceSettings.multiThreadStream.toString()
		);
	}

	return helperArgs;
}
