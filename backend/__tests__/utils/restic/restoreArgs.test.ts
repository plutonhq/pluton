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

	describe('delete at the original location', () => {
		const rootDelete = { ...request, target: '/', delete: true, includes: [], excludes: [] };

		it('limits a full restore to the plan sources', () => {
			const { args } = buildResticRestoreCommand({
				...rootDelete,
				sources: ['/data[1]', 'ip#/srv/*.log', '/home/user'],
			});
			expect(valuesOf(args, '--include')).toEqual(['/data[[]1]', '/home/user']);
			expect(args).toContain('--delete');
		});

		it('refuses a list of cleared items', () => {
			expect(() =>
				buildResticRestoreCommand({ ...rootDelete, excludes: ['/data/a.txt'], sources: ['/data'] })
			).toThrow('Delete needs selected items');
		});

		it('refuses the whole disk', () => {
			expect(() => buildResticRestoreCommand({ ...rootDelete, sources: ['/', '/boot'] })).toThrow(
				'Delete cannot restore the whole disk'
			);
			expect(() => buildResticRestoreCommand({ ...rootDelete, includes: ['/'] })).toThrow(
				'Delete cannot restore the whole disk'
			);
		});

		it('keeps the selected items as they are', () => {
			const { args } = buildResticRestoreCommand({
				...rootDelete,
				includes: ['/data/a.txt'],
				sources: ['/data'],
			});
			expect(valuesOf(args, '--include')).toEqual(['/data/a.txt']);
		});

		it('allows a list of cleared items without delete or with a custom target', () => {
			const excludes = ['/data/a.txt'];
			expect(() => buildResticRestoreCommand({ ...rootDelete, delete: false, excludes })).not.toThrow();
			expect(() => buildResticRestoreCommand({ ...rootDelete, target: '/restore', excludes })).not.toThrow();
		});
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
