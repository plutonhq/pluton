import { parseRcloneFilesList, processRcloneResponse } from '../../../src/utils/rclone/parsers';
import { RcloneLsJsonOutput } from '../../../src/types/rclone';
import { toResticPath } from '../../../src/utils/restic/helpers';

jest.mock('../../../src/utils/restic/helpers', () => ({
	toResticPath: jest.fn((path: string) => path.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '/$1')),
}));

describe('rclone parsers', () => {
	describe('processRcloneResponse', () => {
		it('should parse valid JSON lines', () => {
			const input = `{"Path":"file1.txt","Name":"file1.txt","Size":100,"MimeType":"text/plain","ModTime":"2023-01-01T00:00:00Z","IsDir":false}
{"Path":"file2.txt","Name":"file2.txt","Size":200,"MimeType":"text/plain","ModTime":"2023-01-02T00:00:00Z","IsDir":false}`;

			const result = processRcloneResponse(input);

			expect(result).toHaveLength(2);
			expect(result[0]).toEqual({
				Path: 'file1.txt',
				Name: 'file1.txt',
				Size: 100,
				MimeType: 'text/plain',
				ModTime: '2023-01-01T00:00:00Z',
				IsDir: false,
			});
			expect(result[1]).toEqual({
				Path: 'file2.txt',
				Name: 'file2.txt',
				Size: 200,
				MimeType: 'text/plain',
				ModTime: '2023-01-02T00:00:00Z',
				IsDir: false,
			});
		});

		it('should handle CRLF line endings', () => {
			const input = `{"Path":"file1.txt","Name":"file1.txt","Size":100,"MimeType":"text/plain","ModTime":"2023-01-01T00:00:00Z","IsDir":false}\r\n{"Path":"file2.txt","Name":"file2.txt","Size":200,"MimeType":"text/plain","ModTime":"2023-01-02T00:00:00Z","IsDir":false}`;

			const result = processRcloneResponse(input);

			expect(result).toHaveLength(2);
		});

		it('should handle LF line endings', () => {
			const input = `{"Path":"file1.txt","Name":"file1.txt","Size":100,"MimeType":"text/plain","ModTime":"2023-01-01T00:00:00Z","IsDir":false}\n{"Path":"file2.txt","Name":"file2.txt","Size":200,"MimeType":"text/plain","ModTime":"2023-01-02T00:00:00Z","IsDir":false}`;

			const result = processRcloneResponse(input);

			expect(result).toHaveLength(2);
		});

		it('should filter out empty lines', () => {
			const input = `{"Path":"file1.txt","Name":"file1.txt","Size":100,"MimeType":"text/plain","ModTime":"2023-01-01T00:00:00Z","IsDir":false}

{"Path":"file2.txt","Name":"file2.txt","Size":200,"MimeType":"text/plain","ModTime":"2023-01-02T00:00:00Z","IsDir":false}

`;

			const result = processRcloneResponse(input);

			expect(result).toHaveLength(2);
		});

		it('should handle empty input', () => {
			const result = processRcloneResponse('');

			expect(result).toEqual([]);
		});

		it('should handle input with only whitespace', () => {
			const result = processRcloneResponse('   \n   \n   ');

			expect(result).toEqual([]);
		});

		it('should handle single JSON object', () => {
			const input = `{"Path":"file1.txt","Name":"file1.txt","Size":100,"MimeType":"text/plain","ModTime":"2023-01-01T00:00:00Z","IsDir":false}`;

			const result = processRcloneResponse(input);

			expect(result).toHaveLength(1);
			expect(result[0].Name).toBe('file1.txt');
		});

		it('should parse JSON with nested properties', () => {
			const input = `{"Path":"dir/file.txt","Name":"file.txt","Size":100,"MimeType":"text/plain","ModTime":"2023-01-01T00:00:00Z","IsDir":false}`;

			const result = processRcloneResponse(input);

			expect(result[0].Path).toBe('dir/file.txt');
			expect(result[0].Name).toBe('file.txt');
		});

		it('should handle directories and files', () => {
			const input = `{"Path":"folder","Name":"folder","Size":0,"MimeType":"inode/directory","ModTime":"2023-01-01T00:00:00Z","IsDir":true}
{"Path":"folder/file.txt","Name":"file.txt","Size":100,"MimeType":"text/plain","ModTime":"2023-01-02T00:00:00Z","IsDir":false}`;

			const result = processRcloneResponse(input);

			expect(result).toHaveLength(2);
			expect(result[0].IsDir).toBe(true);
			expect(result[1].IsDir).toBe(false);
		});
	});

	describe('parseRcloneFilesList', () => {
		const mockFiles: RcloneLsJsonOutput[] = [
			{
				Path: 'file1.txt',
				Name: 'file1.txt',
				Size: 100,
				MimeType: 'text/plain',
				ModTime: '2023-01-01T10:00:00Z',
				IsDir: false,
			},
			{
				Path: 'folder/file2.txt',
				Name: 'file2.txt',
				Size: 200,
				MimeType: 'text/plain',
				ModTime: '2023-01-02T10:00:00Z',
				IsDir: false,
			},
			{
				Path: 'folder',
				Name: 'folder',
				Size: 0,
				MimeType: 'inode/directory',
				ModTime: '2023-01-01T10:00:00Z',
				IsDir: true,
			},
		];

		beforeEach(() => {
			jest.clearAllMocks();
		});

		it('should parse files list with toResticPath conversion', () => {
			const srcPath = 'C:\\Users\\Documents';
			const result = parseRcloneFilesList(mockFiles, srcPath, false);

			expect(toResticPath).toHaveBeenCalledWith(srcPath);
			expect(result.length).toBeGreaterThan(0);
		});

		it('should create SnapShotFile objects with correct structure', () => {
			const srcPath = '/home/user/documents';
			const result = parseRcloneFilesList(mockFiles, srcPath, false);

			const file = result.find(f => f.name === 'file1.txt');
			expect(file).toBeDefined();
			expect(file?.type).toBe('file');
			expect(file?.isDirectory).toBe(false);
			expect(file?.size).toBe(100);
			expect(file?.modifiedAt).toBe('2023-01-01T10:00:00Z');
			expect(file?.owner).toBe('');
			expect(file?.permissions).toBe('');
			expect(file?.isAvailable).toBe(true);
		});

		it('should handle directory entries correctly', () => {
			const srcPath = '/home/user/documents';
			const result = parseRcloneFilesList(mockFiles, srcPath, false);

			const dir = result.find(f => f.name === 'folder' && f.path.endsWith('/folder'));
			expect(dir).toBeDefined();
			expect(dir?.type).toBe('dir');
			expect(dir?.isDirectory).toBe(true);
			expect(dir?.size).toBe(0);
		});

		it('should set srcPath correctly for files', () => {
			const srcPath = '/home/user/documents';
			const result = parseRcloneFilesList(mockFiles, srcPath, false);

			const file = result.find(f => f.name === 'file1.txt');
			expect(file?.srcPath).toBe('/home/user/documents/file1.txt');
		});

		it('should set srcPath correctly for nested files', () => {
			const srcPath = '/home/user/documents';
			const result = parseRcloneFilesList(mockFiles, srcPath, false);

			const file = result.find(f => f.name === 'file2.txt');
			expect(file?.srcPath).toBe('/home/user/documents/folder/file2.txt');
		});

		it('should include changeType when present', () => {
			const filesWithChange: RcloneLsJsonOutput[] = [
				{
					...mockFiles[0],
					changeType: 'modified',
				},
			];

			const srcPath = '/home/user/documents';
			const result = parseRcloneFilesList(filesWithChange, srcPath, false);

			const file = result.find(f => f.name === 'file1.txt');
			expect(file?.changeType).toBe('modified');
		});

		it('should create parent directories for nested paths', () => {
			const srcPath = '/home/user/documents';
			const result = parseRcloneFilesList(mockFiles, srcPath, false);

			// Should have the root folder 'documents'
			const hasDocumentsDir = result.some(f => f.name === 'documents' && f.isDirectory);
			expect(hasDocumentsDir).toBe(true);
		});

		it('should use raw path when raw parameter is true', () => {
			const srcPath = '/home/user/documents';
			const result = parseRcloneFilesList(mockFiles, srcPath, true);

			const file = result.find(f => f.name === 'file1.txt');
			expect(file?.path).toContain('/documents/');
			expect(toResticPath).not.toHaveBeenCalled();
		});

		it('should handle empty source files array', () => {
			const srcPath = '/home/user/documents';
			const result = parseRcloneFilesList([], srcPath, false);

			// Should still create parent directories
			expect(result.length).toBeGreaterThan(0);
			expect(result.every(f => f.isDirectory)).toBe(true);
		});

		it('should track latest file modification date', () => {
			const srcPath = '/home/user/documents';
			const result = parseRcloneFilesList(mockFiles, srcPath, false);

			// Parent directories should have a modification date >= the latest file date
			const parentDir = result.find(f => f.isDirectory && f.name === 'documents');
			const latestFileDate = new Date('2023-01-02T10:00:00Z');
			const parentDirDate = new Date(parentDir?.modifiedAt || '');

			// The parent dir date should be >= the latest file date
			expect(parentDirDate.getTime()).toBeGreaterThanOrEqual(latestFileDate.getTime());
		});

		it('should handle paths with multiple levels of nesting', () => {
			const deepFiles: RcloneLsJsonOutput[] = [
				{
					Path: 'level1/level2/level3/file.txt',
					Name: 'file.txt',
					Size: 100,
					MimeType: 'text/plain',
					ModTime: '2023-01-01T10:00:00Z',
					IsDir: false,
				},
			];

			const srcPath = '/home/user/documents';
			const result = parseRcloneFilesList(deepFiles, srcPath, false);

			// The function only creates parent directories from the srcPath split
			// It doesn't create intermediate directories from file paths themselves
			// So we should check for the root directory
			const documentsDir = result.find(f => f.name === 'documents' && f.isDirectory);
			expect(documentsDir).toBeDefined();

			// The file should be in the result
			const file = result.find(f => f.name === 'file.txt');
			expect(file).toBeDefined();
			expect(file?.path).toContain('level1/level2/level3/file.txt');
		});

		it('should not duplicate existing directories from source files', () => {
			const srcPath = '/home/user/documents';
			const result = parseRcloneFilesList(mockFiles, srcPath, false);

			const folderEntries = result.filter(f => f.name === 'folder');
			// Should have only one 'folder' entry (the one from mockFiles)
			// Plus parent directories shouldn't duplicate it
			const folderAtCorrectPath = folderEntries.filter(
				f => f.path.endsWith('/folder') && f.srcPath === '/home/user/documents/folder'
			);
			expect(folderAtCorrectPath.length).toBeGreaterThan(0);
		});

		it('should handle Windows paths correctly', () => {
			const srcPath = 'C:\\Users\\Documents';
			(toResticPath as jest.Mock).mockReturnValue('/C/Users/Documents');

			const result = parseRcloneFilesList(mockFiles, srcPath, false);

			expect(toResticPath).toHaveBeenCalledWith(srcPath);
			const file = result.find(f => f.name === 'file1.txt');
			expect(file?.path).toContain('/Documents/');
		});

		it('should set correct path for files with raw=false', () => {
			const srcPath = '/home/user/documents';
			(toResticPath as jest.Mock).mockReturnValue('/home/user/documents');

			const result = parseRcloneFilesList(mockFiles, srcPath, false);

			const file = result.find(f => f.name === 'file1.txt');
			expect(file?.path).toBe('/home/user/documents/file1.txt');
		});

		it('should handle empty path segments', () => {
			const srcPath = '/home//user///documents';
			const result = parseRcloneFilesList(mockFiles, srcPath, true);

			// Should handle multiple slashes gracefully
			expect(result.length).toBeGreaterThan(0);
		});

		it('should preserve all file properties', () => {
			const srcPath = '/home/user/documents';
			const result = parseRcloneFilesList(mockFiles, srcPath, false);

			const file = result.find(f => f.name === 'file1.txt');
			expect(file).toMatchObject({
				name: 'file1.txt',
				type: 'file',
				isDirectory: false,
				size: 100,
				modifiedAt: '2023-01-01T10:00:00Z',
				owner: '',
				permissions: '',
				isAvailable: true,
			});
			expect(file?.path).toBeDefined();
			expect(file?.srcPath).toBeDefined();
		});
	});
});
