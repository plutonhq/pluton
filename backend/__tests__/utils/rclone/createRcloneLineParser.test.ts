import { SnapshotIndexSource } from '../../../src/types/snapshotIndex';
import { createRcloneLineParser } from '../../../src/utils/rclone/parsers';

describe('createRcloneLineParser', () => {
	const file = '{"Path":"sub/a.txt","Name":"a.txt","Size":5,"ModTime":"2026-10-31T21:32:25.2106881+06:00","IsDir":false}';

	function parser(srcPath: string) {
		const sources: SnapshotIndexSource[] = [];
		const parse = createRcloneLineParser(sources);
		parse(JSON.stringify({ srcPath }));
		return { parse, sources };
	}

	it('skips the array brackets', () => {
		const { parse } = parser('/data');
		expect(parse('[')).toBeNull();
		expect(parse(']')).toBeNull();
	});

	it('reads a line with or without the trailing comma', () => {
		const { parse } = parser('/data');
		const expected = {
			path: '/data/sub/a.txt',
			type: 'file',
			size: 5,
			mtime: Date.UTC(2026, 9, 31, 15, 32, 25, 210),
			perm: null,
		};
		expect(parse(file)).toEqual(expected);
		expect(parse(`${file},`)).toEqual(expected);
	});

	it.each([[0], [-1]])('gives a directory with size %i a size of 0', size => {
		const { parse } = parser('/data');
		const line = JSON.stringify({ Path: 'sub', Name: 'sub', Size: size, IsDir: true });
		expect(parse(line)).toMatchObject({ path: '/data/sub', type: 'dir', size: 0, mtime: null });
	});

	it('keeps the drive letter case of a Windows source', () => {
		const { parse, sources } = parser('C:\\Users\\me\\data');
		expect(parse(file)?.path).toBe('/C/Users/me/data/sub/a.txt');
		expect(sources).toEqual([{ root: '/C/Users/me/data', srcPath: 'C:\\Users\\me\\data' }]);
	});

	it('adds the folder of a source, because an empty source has no lines', () => {
		const parse = createRcloneLineParser([]);
		expect(parse('{"srcPath":"/data"}')).toEqual({
			path: '/data',
			type: 'dir',
			size: 0,
			mtime: null,
			perm: null,
		});
		expect(parse('{"srcPath":"/"}')).toBeNull();
	});

	it('removes a trailing slash from the root', () => {
		const { parse, sources } = parser('/data/');
		expect(parse(file)?.path).toBe('/data/sub/a.txt');
		expect(sources[0].root).toBe('/data');
	});

	it('lists from the file system root', () => {
		const { parse } = parser('/');
		expect(parse(file)?.path).toBe('/sub/a.txt');
	});

	it('uses the root of the most recent source', () => {
		const sources: SnapshotIndexSource[] = [];
		const parse = createRcloneLineParser(sources);
		parse('{"srcPath":"/one"}');
		expect(parse(file)?.path).toBe('/one/sub/a.txt');
		parse('{"srcPath":"/two"}');
		expect(parse(file)?.path).toBe('/two/sub/a.txt');
		expect(sources.map(source => source.root)).toEqual(['/one', '/two']);
	});

	it('throws on a damaged line', () => {
		const { parse } = parser('/data');
		expect(() => parse('{"Path":')).toThrow();
	});
});
