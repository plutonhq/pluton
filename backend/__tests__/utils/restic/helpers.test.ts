import {
	generateResticRepoPath,
	toResticPath,
	resticPathToWindows,
} from '../../../src/utils/restic/helpers';

describe('Restic Helpers', () => {
	describe('generateResticRepoPath', () => {
		it('should generate repo path with storage name and path', () => {
			const result = generateResticRepoPath('myStorage', 'backups/restic');
			expect(result).toBe('rclone:myStorage:backups/restic');
		});

		it('should generate repo path with empty storage path', () => {
			const result = generateResticRepoPath('myStorage', '');
			expect(result).toBe('rclone:myStorage:');
		});

		it('should generate repo path with root storage path', () => {
			const result = generateResticRepoPath('myStorage', '/');
			expect(result).toBe('rclone:myStorage:/');
		});

		it('should handle storage path with leading slash', () => {
			const result = generateResticRepoPath('s3bucket', '/data/backups');
			expect(result).toBe('rclone:s3bucket:/data/backups');
		});

		it('should handle storage path with trailing slash', () => {
			const result = generateResticRepoPath('gdrive', 'backups/');
			expect(result).toBe('rclone:gdrive:backups/');
		});

		it('should handle special characters in storage name', () => {
			const result = generateResticRepoPath('my-storage_01', 'path/to/backups');
			expect(result).toBe('rclone:my-storage_01:path/to/backups');
		});
	});

	describe('toResticPath', () => {
		describe('Windows paths', () => {
			it('should convert Windows absolute path to restic format', () => {
				const result = toResticPath('C:\\Users\\Documents\\file.txt');
				expect(result).toBe('/C/Users/Documents/file.txt');
			});

			it('should convert Windows path with drive letter to restic format', () => {
				const result = toResticPath('D:\\Projects\\pluton');
				expect(result).toBe('/D/Projects/pluton');
			});

			it('should handle mixed separators in Windows paths', () => {
				const result = toResticPath('C:\\Users/Documents\\file.txt');
				expect(result).toBe('/C/Users/Documents/file.txt');
			});

			it('should handle lowercase drive letters', () => {
				const result = toResticPath('c:\\temp\\backup');
				expect(result).toBe('/c/temp/backup');
			});

			it('should handle paths with trailing backslash', () => {
				const result = toResticPath('C:\\Users\\Documents\\');
				expect(result).toBe('/C/Users/Documents/');
			});

			it('should handle UNC paths', () => {
				const result = toResticPath('\\\\server\\share\\folder');
				expect(result).toBe('//server/share/folder');
			});
		});

		describe('Unix paths', () => {
			it('should handle Unix absolute paths', () => {
				const result = toResticPath('/home/user/documents');
				expect(result).toBe('/home/user/documents');
			});

			it('should handle Unix relative paths', () => {
				const result = toResticPath('relative/path/file.txt');
				expect(result).toBe('/relative/path/file.txt');
			});

			it('should handle paths with trailing slash', () => {
				const result = toResticPath('/var/log/');
				expect(result).toBe('/var/log/');
			});

			it('should handle root path', () => {
				const result = toResticPath('/');
				expect(result).toBe('/');
			});
		});

		describe('Edge cases', () => {
			it('should handle empty string', () => {
				const result = toResticPath('');
				expect(result).toBe('/.');
			});

			it('should handle single dot (current directory)', () => {
				const result = toResticPath('.');
				expect(result).toBe('/.');
			});

			it('should handle double dot (parent directory)', () => {
				const result = toResticPath('..');
				expect(result).toBe('/..');
			});

			it('should handle paths with spaces', () => {
				const result = toResticPath('C:\\Program Files\\My App\\data');
				expect(result).toBe('/C/Program Files/My App/data');
			});

			it('should handle paths with special characters', () => {
				const result = toResticPath('C:\\Files\\my-file_01.txt');
				expect(result).toBe('/C/Files/my-file_01.txt');
			});

			it('should normalize redundant separators', () => {
				const result = toResticPath('C:\\\\Users\\\\Documents');
				expect(result).toBe('/C/Users/Documents');
			});
		});
	});

	describe('resticPathToWindows', () => {
		describe('Drive letter paths', () => {
			it('should convert restic path with drive letter to Windows format', () => {
				const result = resticPathToWindows('/C/Users/Documents/file.txt');
				expect(result).toBe('C:\\Users\\Documents\\file.txt');
			});

			it('should convert restic path with lowercase drive letter', () => {
				const result = resticPathToWindows('/d/projects/pluton');
				expect(result).toBe('d:\\projects\\pluton');
			});

			it('should handle single character drive letter', () => {
				const result = resticPathToWindows('/E/data');
				expect(result).toBe('E:\\data');
			});

			it('should handle drive letter with single file', () => {
				const result = resticPathToWindows('/C/file.txt');
				expect(result).toBe('C:\\file.txt');
			});

			it('should handle drive letter only path', () => {
				const result = resticPathToWindows('/C');
				expect(result).toBe('C');
			});
		});

		describe('Non-drive letter paths', () => {
			it('should convert Unix-style path without drive letter', () => {
				const result = resticPathToWindows('/home/user/documents');
				expect(result).toBe('home\\user\\documents');
			});

			it('should handle paths with multiple segments', () => {
				const result = resticPathToWindows('/var/log/app/error.log');
				expect(result).toBe('var\\log\\app\\error.log');
			});

			it('should handle paths starting with multiple slashes', () => {
				const result = resticPathToWindows('///C/Users/Documents');
				expect(result).toBe('C:\\Users\\Documents');
			});

			it('should handle UNC-style paths', () => {
				const result = resticPathToWindows('/server/share/folder');
				expect(result).toBe('server\\share\\folder');
			});
		});

		describe('Edge cases', () => {
			it('should handle single slash', () => {
				const result = resticPathToWindows('/');
				expect(result).toBe('');
			});

			it('should handle empty string', () => {
				const result = resticPathToWindows('');
				expect(result).toBe('');
			});

			it('should handle path with spaces', () => {
				const result = resticPathToWindows('/C/Program Files/My App');
				expect(result).toBe('C:\\Program Files\\My App');
			});

			it('should handle path with special characters', () => {
				const result = resticPathToWindows('/C/Files/my-file_01.txt');
				expect(result).toBe('C:\\Files\\my-file_01.txt');
			});

			it('should handle path with trailing slash', () => {
				const result = resticPathToWindows('/C/Users/Documents/');
				expect(result).toBe('C:\\Users\\Documents\\');
			});

			it('should not treat two-letter segments as drive letters', () => {
				const result = resticPathToWindows('/ab/cd/ef');
				expect(result).toBe('ab\\cd\\ef');
			});
		});

		describe('Round-trip conversions', () => {
			it('should maintain path integrity in round-trip conversion for simple paths', () => {
				const originalPath = 'C:\\Users\\Documents\\file.txt';
				const resticPath = toResticPath(originalPath);
				const backToWindows = resticPathToWindows(resticPath);
				expect(backToWindows).toBe(originalPath);
			});

			it('should handle complex paths in round-trip', () => {
				const originalPath = 'D:\\Program Files\\My App\\data\\config.json';
				const resticPath = toResticPath(originalPath);
				const backToWindows = resticPathToWindows(resticPath);
				expect(backToWindows).toBe(originalPath);
			});

			it('should handle paths with spaces in round-trip', () => {
				const originalPath = 'C:\\My Documents\\Important Files\\file.txt';
				const resticPath = toResticPath(originalPath);
				const backToWindows = resticPathToWindows(resticPath);
				expect(backToWindows).toBe(originalPath);
			});

			it('should handle paths without trailing slashes in round-trip', () => {
				const originalPath = 'C:\\Users\\Documents';
				const resticPath = toResticPath(originalPath);
				const backToWindows = resticPathToWindows(resticPath);
				expect(backToWindows).toBe(originalPath);
			});
		});
	});

	describe('Integration scenarios', () => {
		it('should correctly handle backup path workflow', () => {
			const repoPath = generateResticRepoPath('s3-backup', 'backups/prod');
			const sourcePath = toResticPath('C:\\Users\\Admin\\Documents');

			expect(repoPath).toBe('rclone:s3-backup:backups/prod');
			expect(sourcePath).toBe('/C/Users/Admin/Documents');
		});

		it('should correctly handle restore path workflow', () => {
			const resticPath = '/C/Users/Admin/Documents/file.txt';
			const windowsPath = resticPathToWindows(resticPath);

			expect(windowsPath).toBe('C:\\Users\\Admin\\Documents\\file.txt');
		});

		it('should handle multiple backup sources', () => {
			const sources = ['C:\\Users\\Admin\\Documents', 'D:\\Projects', 'E:\\Backups'];

			const resticPaths = sources.map(toResticPath);

			expect(resticPaths).toEqual(['/C/Users/Admin/Documents', '/D/Projects', '/E/Backups']);
		});
	});
});
