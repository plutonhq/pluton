import getBackupSourceFiles from '../../src/utils/getBackupSourceFiles';
import { runRcloneCommand } from '../../src/utils/rclone/rclone';
import { parseRcloneFilesList } from '../../src/utils/rclone/parsers';
import { RcloneLsJsonOutput } from '../../src/types/rclone';
import { SnapShotFile } from '../../src/types/restic';

// Mock dependencies
jest.mock('../../src/utils/rclone/rclone');
jest.mock('../../src/utils/rclone/parsers');

const mockRunRcloneCommand = runRcloneCommand as jest.MockedFunction<typeof runRcloneCommand>;
const mockParseRcloneFilesList = parseRcloneFilesList as jest.MockedFunction<
	typeof parseRcloneFilesList
>;

describe('getBackupSourceFiles', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		jest.spyOn(console, 'log').mockImplementation();
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	describe('successful operations', () => {
		it('should return files from a single source path', async () => {
			const mockRcloneOutput: RcloneLsJsonOutput[] = [
				{
					Path: 'file1.txt',
					Name: 'file1.txt',
					Size: 100,
					MimeType: 'text/plain',
					ModTime: '2024-01-01T00:00:00Z',
					IsDir: false,
				},
				{
					Path: 'file2.txt',
					Name: 'file2.txt',
					Size: 200,
					MimeType: 'text/plain',
					ModTime: '2024-01-02T00:00:00Z',
					IsDir: false,
				},
			];

			const mockParsedFiles: SnapShotFile[] = [
				{
					name: 'file1.txt',
					path: '/source/file1.txt',
					type: 'file',
					isDirectory: false,
					size: 100,
					modifiedAt: '2024-01-01T00:00:00Z',
					owner: 'user',
					permissions: '0644',
					isAvailable: true,
				},
				{
					name: 'file2.txt',
					path: '/source/file2.txt',
					type: 'file',
					isDirectory: false,
					size: 200,
					modifiedAt: '2024-01-02T00:00:00Z',
					owner: 'user',
					permissions: '0644',
					isAvailable: true,
				},
			];

			mockRunRcloneCommand.mockResolvedValue(JSON.stringify(mockRcloneOutput));
			mockParseRcloneFilesList.mockReturnValue(mockParsedFiles);

			const result = await getBackupSourceFiles(['/source']);

			expect(result.success).toBe(true);
			expect(result.result).toEqual(mockParsedFiles);
			expect(mockRunRcloneCommand).toHaveBeenCalledWith([
				'lsjson',
				'/source',
				'--recursive',
				'--fast-list',
			]);
			expect(mockParseRcloneFilesList).toHaveBeenCalledWith(mockRcloneOutput, '/source', false);
		});

		it('should return files from multiple source paths', async () => {
			const mockRcloneOutput1: RcloneLsJsonOutput[] = [
				{
					Path: 'file1.txt',
					Name: 'file1.txt',
					Size: 100,
					MimeType: 'text/plain',
					ModTime: '2024-01-01T00:00:00Z',
					IsDir: false,
				},
			];

			const mockRcloneOutput2: RcloneLsJsonOutput[] = [
				{
					Path: 'file2.txt',
					Name: 'file2.txt',
					Size: 200,
					MimeType: 'text/plain',
					ModTime: '2024-01-02T00:00:00Z',
					IsDir: false,
				},
			];

			const mockParsedFiles1: SnapShotFile[] = [
				{
					name: 'file1.txt',
					path: '/source1/file1.txt',
					type: 'file',
					isDirectory: false,
					size: 100,
					modifiedAt: '2024-01-01T00:00:00Z',
					owner: 'user',
					permissions: '0644',
					isAvailable: true,
				},
			];

			const mockParsedFiles2: SnapShotFile[] = [
				{
					name: 'file2.txt',
					path: '/source2/file2.txt',
					type: 'file',
					isDirectory: false,
					size: 200,
					modifiedAt: '2024-01-02T00:00:00Z',
					owner: 'user',
					permissions: '0644',
					isAvailable: true,
				},
			];

			mockRunRcloneCommand
				.mockResolvedValueOnce(JSON.stringify(mockRcloneOutput1))
				.mockResolvedValueOnce(JSON.stringify(mockRcloneOutput2));

			mockParseRcloneFilesList
				.mockReturnValueOnce(mockParsedFiles1)
				.mockReturnValueOnce(mockParsedFiles2);

			const result = await getBackupSourceFiles(['/source1', '/source2']);

			expect(result.success).toBe(true);
			expect(result.result).toEqual([...mockParsedFiles1, ...mockParsedFiles2]);
			expect(mockRunRcloneCommand).toHaveBeenCalledTimes(2);
		});

		it('should pass rawPath parameter to parseRcloneFilesList when true', async () => {
			const mockRcloneOutput: RcloneLsJsonOutput[] = [
				{
					Path: 'file1.txt',
					Name: 'file1.txt',
					Size: 100,
					MimeType: 'text/plain',
					ModTime: '2024-01-01T00:00:00Z',
					IsDir: false,
				},
			];

			mockRunRcloneCommand.mockResolvedValue(JSON.stringify(mockRcloneOutput));
			mockParseRcloneFilesList.mockReturnValue([]);

			await getBackupSourceFiles(['/source'], true);

			expect(mockParseRcloneFilesList).toHaveBeenCalledWith(mockRcloneOutput, '/source', true);
		});

		it('should pass rawPath parameter to parseRcloneFilesList when false', async () => {
			const mockRcloneOutput: RcloneLsJsonOutput[] = [
				{
					Path: 'file1.txt',
					Name: 'file1.txt',
					Size: 100,
					MimeType: 'text/plain',
					ModTime: '2024-01-01T00:00:00Z',
					IsDir: false,
				},
			];

			mockRunRcloneCommand.mockResolvedValue(JSON.stringify(mockRcloneOutput));
			mockParseRcloneFilesList.mockReturnValue([]);

			await getBackupSourceFiles(['/source'], false);

			expect(mockParseRcloneFilesList).toHaveBeenCalledWith(mockRcloneOutput, '/source', false);
		});

		it('should use rawPath=false by default', async () => {
			const mockRcloneOutput: RcloneLsJsonOutput[] = [
				{
					Path: 'file1.txt',
					Name: 'file1.txt',
					Size: 100,
					MimeType: 'text/plain',
					ModTime: '2024-01-01T00:00:00Z',
					IsDir: false,
				},
			];

			mockRunRcloneCommand.mockResolvedValue(JSON.stringify(mockRcloneOutput));
			mockParseRcloneFilesList.mockReturnValue([]);

			await getBackupSourceFiles(['/source']);

			expect(mockParseRcloneFilesList).toHaveBeenCalledWith(mockRcloneOutput, '/source', false);
		});
	});

	describe('duplicate file handling', () => {
		it('should filter out duplicate files based on path', async () => {
			const mockRcloneOutput1: RcloneLsJsonOutput[] = [
				{
					Path: 'file1.txt',
					Name: 'file1.txt',
					Size: 100,
					MimeType: 'text/plain',
					ModTime: '2024-01-01T00:00:00Z',
					IsDir: false,
				},
				{
					Path: 'file2.txt',
					Name: 'file2.txt',
					Size: 200,
					MimeType: 'text/plain',
					ModTime: '2024-01-02T00:00:00Z',
					IsDir: false,
				},
			];

			const mockRcloneOutput2: RcloneLsJsonOutput[] = [
				{
					Path: 'file1.txt',
					Name: 'file1.txt',
					Size: 100,
					MimeType: 'text/plain',
					ModTime: '2024-01-01T00:00:00Z',
					IsDir: false,
				},
				{
					Path: 'file3.txt',
					Name: 'file3.txt',
					Size: 300,
					MimeType: 'text/plain',
					ModTime: '2024-01-03T00:00:00Z',
					IsDir: false,
				},
			];

			const mockParsedFiles1: SnapShotFile[] = [
				{
					name: 'file1.txt',
					path: '/common/file1.txt',
					type: 'file',
					isDirectory: false,
					size: 100,
					modifiedAt: '2024-01-01T00:00:00Z',
					owner: 'user',
					permissions: '0644',
					isAvailable: true,
				},
				{
					name: 'file2.txt',
					path: '/common/file2.txt',
					type: 'file',
					isDirectory: false,
					size: 200,
					modifiedAt: '2024-01-02T00:00:00Z',
					owner: 'user',
					permissions: '0644',
					isAvailable: true,
				},
			];

			const mockParsedFiles2: SnapShotFile[] = [
				{
					name: 'file1.txt',
					path: '/common/file1.txt',
					type: 'file',
					isDirectory: false,
					size: 100,
					modifiedAt: '2024-01-01T00:00:00Z',
					owner: 'user',
					permissions: '0644',
					isAvailable: true,
				},
				{
					name: 'file3.txt',
					path: '/common/file3.txt',
					type: 'file',
					isDirectory: false,
					size: 300,
					modifiedAt: '2024-01-03T00:00:00Z',
					owner: 'user',
					permissions: '0644',
					isAvailable: true,
				},
			];

			mockRunRcloneCommand
				.mockResolvedValueOnce(JSON.stringify(mockRcloneOutput1))
				.mockResolvedValueOnce(JSON.stringify(mockRcloneOutput2));

			mockParseRcloneFilesList
				.mockReturnValueOnce(mockParsedFiles1)
				.mockReturnValueOnce(mockParsedFiles2);

			const result = await getBackupSourceFiles(['/source1', '/source2']);

			expect(result.success).toBe(true);
			const files = result.result as SnapShotFile[];
			expect(files).toHaveLength(3);
			expect(files.map(f => f.path)).toEqual([
				'/common/file1.txt',
				'/common/file2.txt',
				'/common/file3.txt',
			]);
		});

		it('should keep first occurrence when duplicates exist', async () => {
			const mockParsedFiles1: SnapShotFile[] = [
				{
					name: 'file.txt',
					path: '/file.txt',
					type: 'file',
					isDirectory: false,
					size: 100,
					modifiedAt: '2024-01-01T00:00:00Z',
					owner: 'user',
					permissions: '0644',
					isAvailable: true,
				},
			];

			const mockParsedFiles2: SnapShotFile[] = [
				{
					name: 'file.txt',
					path: '/file.txt',
					type: 'file',
					isDirectory: false,
					size: 200,
					modifiedAt: '2024-01-02T00:00:00Z',
					owner: 'user',
					permissions: '0644',
					isAvailable: true,
				},
			];

			mockRunRcloneCommand
				.mockResolvedValueOnce(JSON.stringify([]))
				.mockResolvedValueOnce(JSON.stringify([]));

			mockParseRcloneFilesList
				.mockReturnValueOnce(mockParsedFiles1)
				.mockReturnValueOnce(mockParsedFiles2);

			const result = await getBackupSourceFiles(['/source1', '/source2']);

			const files = result.result as SnapShotFile[];
			expect(files).toHaveLength(1);
			expect(files[0].size).toBe(100); // First occurrence
		});
	});

	describe('empty results', () => {
		it('should return empty array when source paths array is empty', async () => {
			const result = await getBackupSourceFiles([]);

			expect(result.success).toBe(true);
			expect(result.result).toEqual([]);
			expect(mockRunRcloneCommand).not.toHaveBeenCalled();
		});

		it('should return empty array when rclone returns empty list', async () => {
			mockRunRcloneCommand.mockResolvedValue(JSON.stringify([]));
			mockParseRcloneFilesList.mockReturnValue([]);

			const result = await getBackupSourceFiles(['/source']);

			expect(result.success).toBe(true);
			expect(result.result).toEqual([]);
		});

		it('should return empty array when all source paths return empty', async () => {
			mockRunRcloneCommand
				.mockResolvedValueOnce(JSON.stringify([]))
				.mockResolvedValueOnce(JSON.stringify([]));

			mockParseRcloneFilesList.mockReturnValue([]);

			const result = await getBackupSourceFiles(['/source1', '/source2']);

			expect(result.success).toBe(true);
			expect(result.result).toEqual([]);
		});
	});

	describe('error handling', () => {
		it('should return error when rclone command fails', async () => {
			mockRunRcloneCommand.mockRejectedValue(new Error('rclone failed'));

			const result = await getBackupSourceFiles(['/source']);

			expect(result.success).toBe(false);
			expect(result.result).toBe('rclone failed');
			expect(console.log).toHaveBeenCalledWith('getBackupSourceFiles error :', expect.any(Error));
		});

		it('should return error when JSON parsing fails', async () => {
			mockRunRcloneCommand.mockResolvedValue('invalid json');

			const result = await getBackupSourceFiles(['/source']);

			expect(result.success).toBe(false);
			expect(result.result).toContain('is not valid JSON');
		});

		it('should return generic error message when error has no message', async () => {
			mockRunRcloneCommand.mockRejectedValue({});

			const result = await getBackupSourceFiles(['/source']);

			expect(result.success).toBe(false);
			expect(result.result).toBe('Failed to get source files');
		});

		it('should return generic error message when error is null', async () => {
			mockRunRcloneCommand.mockRejectedValue(null);

			const result = await getBackupSourceFiles(['/source']);

			expect(result.success).toBe(false);
			expect(result.result).toBe('Failed to get source files');
		});

		it('should handle error on first source and continue with others', async () => {
			const mockRcloneOutput: RcloneLsJsonOutput[] = [
				{
					Path: 'file2.txt',
					Name: 'file2.txt',
					Size: 200,
					MimeType: 'text/plain',
					ModTime: '2024-01-02T00:00:00Z',
					IsDir: false,
				},
			];

			const mockParsedFiles: SnapShotFile[] = [
				{
					name: 'file2.txt',
					path: '/source2/file2.txt',
					type: 'file',
					isDirectory: false,
					size: 200,
					modifiedAt: '2024-01-02T00:00:00Z',
					owner: 'user',
					permissions: '0644',
					isAvailable: true,
				},
			];

			mockRunRcloneCommand
				.mockRejectedValueOnce(new Error('Source 1 failed'))
				.mockResolvedValueOnce(JSON.stringify(mockRcloneOutput));

			mockParseRcloneFilesList.mockReturnValue(mockParsedFiles);

			const result = await getBackupSourceFiles(['/source1', '/source2']);

			expect(result.success).toBe(false);
			expect(result.result).toBe('Source 1 failed');
			expect(console.log).toHaveBeenCalled();
		});

		it('should handle error on middle source', async () => {
			mockRunRcloneCommand
				.mockResolvedValueOnce(JSON.stringify([]))
				.mockRejectedValueOnce(new Error('Source 2 failed'))
				.mockResolvedValueOnce(JSON.stringify([]));

			mockParseRcloneFilesList.mockReturnValue([]);

			const result = await getBackupSourceFiles(['/source1', '/source2', '/source3']);

			expect(result.success).toBe(false);
			expect(result.result).toBe('Source 2 failed');
		});

		it('should handle parseRcloneFilesList throwing error', async () => {
			mockRunRcloneCommand.mockResolvedValue(JSON.stringify([]));
			mockParseRcloneFilesList.mockImplementation(() => {
				throw new Error('Parse error');
			});

			const result = await getBackupSourceFiles(['/source']);

			expect(result.success).toBe(false);
			expect(result.result).toBe('Parse error');
		});
	});

	describe('rclone command arguments', () => {
		it('should call rclone with correct arguments', async () => {
			mockRunRcloneCommand.mockResolvedValue(JSON.stringify([]));
			mockParseRcloneFilesList.mockReturnValue([]);

			await getBackupSourceFiles(['/my/source/path']);

			expect(mockRunRcloneCommand).toHaveBeenCalledWith([
				'lsjson',
				'/my/source/path',
				'--recursive',
				'--fast-list',
			]);
		});

		it('should call rclone for each source path with correct path', async () => {
			mockRunRcloneCommand.mockResolvedValue(JSON.stringify([]));
			mockParseRcloneFilesList.mockReturnValue([]);

			const sourcePaths = ['/path1', '/path2', '/path3'];
			await getBackupSourceFiles(sourcePaths);

			expect(mockRunRcloneCommand).toHaveBeenCalledTimes(3);
			expect(mockRunRcloneCommand).toHaveBeenNthCalledWith(1, [
				'lsjson',
				'/path1',
				'--recursive',
				'--fast-list',
			]);
			expect(mockRunRcloneCommand).toHaveBeenNthCalledWith(2, [
				'lsjson',
				'/path2',
				'--recursive',
				'--fast-list',
			]);
			expect(mockRunRcloneCommand).toHaveBeenNthCalledWith(3, [
				'lsjson',
				'/path3',
				'--recursive',
				'--fast-list',
			]);
		});
	});

	describe('file types and metadata', () => {
		it('should handle directories in the file list', async () => {
			const mockRcloneOutput: RcloneLsJsonOutput[] = [
				{
					Path: 'dir1',
					Name: 'dir1',
					Size: 0,
					MimeType: 'inode/directory',
					ModTime: '2024-01-01T00:00:00Z',
					IsDir: true,
				},
				{
					Path: 'file1.txt',
					Name: 'file1.txt',
					Size: 100,
					MimeType: 'text/plain',
					ModTime: '2024-01-02T00:00:00Z',
					IsDir: false,
				},
			];

			const mockParsedFiles: SnapShotFile[] = [
				{
					name: 'dir1',
					path: '/source/dir1',
					type: 'dir',
					isDirectory: true,
					size: 0,
					modifiedAt: '2024-01-01T00:00:00Z',
					owner: 'user',
					permissions: '0755',
					isAvailable: true,
				},
				{
					name: 'file1.txt',
					path: '/source/file1.txt',
					type: 'file',
					isDirectory: false,
					size: 100,
					modifiedAt: '2024-01-02T00:00:00Z',
					owner: 'user',
					permissions: '0644',
					isAvailable: true,
				},
			];

			mockRunRcloneCommand.mockResolvedValue(JSON.stringify(mockRcloneOutput));
			mockParseRcloneFilesList.mockReturnValue(mockParsedFiles);

			const result = await getBackupSourceFiles(['/source']);

			expect(result.success).toBe(true);
			const files = result.result as SnapShotFile[];
			expect(files).toHaveLength(2);
			expect(files[0].type).toBe('dir');
			expect(files[0].isDirectory).toBe(true);
			expect(files[1].type).toBe('file');
			expect(files[1].isDirectory).toBe(false);
		});

		it('should preserve file metadata', async () => {
			const mockRcloneOutput: RcloneLsJsonOutput[] = [
				{
					Path: 'file.txt',
					Name: 'file.txt',
					Size: 12345,
					MimeType: 'text/plain',
					ModTime: '2024-10-20T12:00:00Z',
					IsDir: false,
				},
			];

			const mockParsedFiles: SnapShotFile[] = [
				{
					name: 'file.txt',
					path: '/source/file.txt',
					type: 'file',
					isDirectory: false,
					size: 12345,
					modifiedAt: '2024-10-20T12:00:00Z',
					owner: 'user',
					permissions: '0644',
					isAvailable: true,
				},
			];

			mockRunRcloneCommand.mockResolvedValue(JSON.stringify(mockRcloneOutput));
			mockParseRcloneFilesList.mockReturnValue(mockParsedFiles);

			const result = await getBackupSourceFiles(['/source']);

			const files = result.result as SnapShotFile[];
			expect(files[0]).toEqual({
				name: 'file.txt',
				path: '/source/file.txt',
				type: 'file',
				isDirectory: false,
				size: 12345,
				modifiedAt: '2024-10-20T12:00:00Z',
				owner: 'user',
				permissions: '0644',
				isAvailable: true,
			});
		});
	});
});
