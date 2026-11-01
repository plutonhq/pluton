import {
	buildHelperRestoreArgs,
	buildResticRestoreCommand,
	NormalizedRestoreRequest,
} from '../../../src/utils/restic/restoreArgs';

jest.mock('../../../src/utils/AppPaths', () => ({
	appPaths: { getRestoresDir: () => '/restores' },
}));

const request: NormalizedRestoreRequest = {
	backupId: 'b1',
	snapshotId: 's1',
	repoPath: 'rclone:store:repo',
	repoPassword: '',
	encryption: true,
	target: '/restore',
	overwrite: 'always',
	includes: ['/d/report[1].pdf'],
	excludes: ['/d/a*.txt'],
	delete: false,
	dryRun: false,
	sources: [],
};

function valuesOf(args: string[], flag: string) {
	return args.filter((_, i) => args[i - 1] === flag);
}

describe('restore arguments', () => {
	it('sends literal paths to restic', () => {
		const { args } = buildResticRestoreCommand(request);
		expect(valuesOf(args, '--include')).toEqual(['/d/report[[]1].pdf']);
		expect(valuesOf(args, '--exclude')).toEqual(['/d/a[*].txt']);
	});

	it('sends literal paths to the helper', () => {
		const args = buildHelperRestoreArgs(request);
		expect(valuesOf(args, '--include')).toEqual(['/d/report[[]1].pdf']);
		expect(valuesOf(args, '--exclude')).toEqual(['/d/a[*].txt']);
	});

	it('sends literal source paths to the helper', () => {
		const args = buildHelperRestoreArgs({
			...request,
			target: '/',
			includes: [],
			sources: ['/data[1]'],
		});
		expect(valuesOf(args, '--include')).toEqual(['/data[[]1]']);
	});
});
