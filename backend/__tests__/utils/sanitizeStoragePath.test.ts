import * as os from 'os';
import * as path from 'path';
import { sanitizeStoragePath } from '../../src/utils/sanitizeStoragePath';
import { AppError } from '../../src/utils/AppError';

describe('sanitizeStoragePath', () => {
	describe('input validation', () => {
		it('should return empty string for non-string input', () => {
			expect(sanitizeStoragePath(null as any, 'local')).toBe('');
			expect(sanitizeStoragePath(undefined as any, 'local')).toBe('');
			expect(sanitizeStoragePath(123 as any, 'local')).toBe('');
			expect(sanitizeStoragePath({} as any, 'local')).toBe('');
		});

		it('should trim whitespace from input', () => {
			const result = sanitizeStoragePath('  /some/path  ', 's3');
			expect(result).toBe('some/path');
		});

		it('should handle empty string input', () => {
			expect(sanitizeStoragePath('', 'local')).toBe(path.resolve(''));
			expect(sanitizeStoragePath('', 's3')).toBe('');
		});
	});

	describe('security checks', () => {
		it('should reject directory traversal with ".." sequences', () => {
			expect(() => sanitizeStoragePath('../etc/passwd', 'local')).toThrow(AppError);
			expect(() => sanitizeStoragePath('../etc/passwd', 'local')).toThrow(
				'Directory traversal sequences'
			);
		});

		it('should reject multiple ".." sequences', () => {
			expect(() => sanitizeStoragePath('../../secret', 'local')).toThrow(AppError);
			expect(() => sanitizeStoragePath('../../../etc', 's3')).toThrow(AppError);
		});

		it('should reject ".." after normalization', () => {
			expect(() => sanitizeStoragePath('./some/../../other', 'local')).toThrow(AppError);
		});
	});

	describe('local storage type', () => {
		it('should return absolute path for local storage', () => {
			const result = sanitizeStoragePath('uploads/files', 'local');
			expect(path.isAbsolute(result)).toBe(true);
		});

		it('should resolve relative paths to absolute paths', () => {
			const result = sanitizeStoragePath('./uploads', 'local');
			expect(path.isAbsolute(result)).toBe(true);
			expect(result).toContain('uploads');
		});

		it('should handle already absolute paths', () => {
			const absolutePath = os.platform() === 'win32' ? 'C:\\uploads\\files' : '/uploads/files';
			const result = sanitizeStoragePath(absolutePath, 'local');
			expect(path.isAbsolute(result)).toBe(true);
		});

		it('should normalize path separators', () => {
			const result = sanitizeStoragePath('uploads//files///documents', 'local');
			expect(result).not.toContain('//');
		});

		it('should resolve "." in path', () => {
			const result = sanitizeStoragePath('./uploads/./files', 'local');
			expect(path.isAbsolute(result)).toBe(true);
			expect(result).not.toContain('/./');
		});

		it('should handle Windows-style paths on Windows', () => {
			if (os.platform() === 'win32') {
				const result = sanitizeStoragePath('C:\\uploads\\files', 'local');
				expect(path.isAbsolute(result)).toBe(true);
				expect(result).toContain('uploads');
			}
		});

		it('should handle Unix-style paths on Unix', () => {
			if (os.platform() !== 'win32') {
				const result = sanitizeStoragePath('/var/uploads/files', 'local');
				expect(path.isAbsolute(result)).toBe(true);
				expect(result).toBe('/var/uploads/files');
			}
		});
	});

	describe('remote storage types (s3, b2, etc.)', () => {
		const remoteStorageTypes = ['s3', 'b2', 'azure', 'gcs'];

		remoteStorageTypes.forEach(storageType => {
			describe(`${storageType} storage`, () => {
				it('should remove leading slash from path', () => {
					const result = sanitizeStoragePath('/bucket/path/file.txt', storageType);
					expect(result).toBe('bucket/path/file.txt');
					expect(result.startsWith('/')).toBe(false);
				});

				it('should remove trailing slash from path', () => {
					const result = sanitizeStoragePath('bucket/path/', storageType);
					expect(result).toBe('bucket/path');
				});

				it('should not remove trailing slash if path is single character', () => {
					const result = sanitizeStoragePath('/', storageType);
					expect(result).toBe('');
				});

				it('should convert backslashes to forward slashes', () => {
					const result = sanitizeStoragePath('bucket\\path\\file.txt', storageType);
					expect(result).toBe('bucket/path/file.txt');
					expect(result).not.toContain('\\');
				});

				it('should handle mixed slashes', () => {
					const result = sanitizeStoragePath('bucket\\path/subpath\\file.txt', storageType);
					expect(result).toBe('bucket/path/subpath/file.txt');
				});

				it('should handle paths without leading slash', () => {
					const result = sanitizeStoragePath('bucket/path/file.txt', storageType);
					expect(result).toBe('bucket/path/file.txt');
				});

				it('should handle multiple leading slashes', () => {
					// The function only removes one leading slash
					const result = sanitizeStoragePath('///bucket/path/file.txt', storageType);
					expect(result).toBe('//bucket/path/file.txt');
				});

				it('should preserve internal path structure', () => {
					const result = sanitizeStoragePath('/a/b/c/d/e/file.txt', storageType);
					expect(result).toBe('a/b/c/d/e/file.txt');
				});

				it('should handle paths with special characters', () => {
					const result = sanitizeStoragePath('/bucket/my-file_v2.txt', storageType);
					expect(result).toBe('bucket/my-file_v2.txt');
				});
			});
		});
	});

	describe('edge cases', () => {
		it('should handle path with only dots (single dot)', () => {
			const result = sanitizeStoragePath('.', 'local');
			expect(path.isAbsolute(result)).toBe(true);
		});

		it('should handle path with only slashes for remote storage', () => {
			// '///' after trim becomes '///', then removing first '/' gives '//'
			// Then removing trailing '/' gives '/'
			const result = sanitizeStoragePath('///', 's3');
			expect(result).toBe('/');
		});

		it('should handle very long paths', () => {
			const longPath = 'a/'.repeat(100) + 'file.txt';
			const result = sanitizeStoragePath(longPath, 's3');
			// The path doesn't have a trailing slash to remove
			expect(result).toBe(longPath);
		});

		it('should preserve file extensions', () => {
			expect(sanitizeStoragePath('file.txt', 's3')).toBe('file.txt');
			expect(sanitizeStoragePath('file.tar.gz', 's3')).toBe('file.tar.gz');
		});

		it('should handle paths with spaces', () => {
			const result = sanitizeStoragePath('/my folder/my file.txt', 's3');
			expect(result).toBe('my folder/my file.txt');
		});

		it('should handle Unicode characters in path', () => {
			const result = sanitizeStoragePath('/文件/файл.txt', 's3');
			expect(result).toBe('文件/файл.txt');
		});
	});

	describe('AppError details', () => {
		it('should throw AppError with status code 400', () => {
			try {
				sanitizeStoragePath('../etc/passwd', 'local');
				fail('Should have thrown an error');
			} catch (error) {
				expect(error).toBeInstanceOf(AppError);
				expect((error as AppError).statusCode).toBe(400);
			}
		});

		it('should throw AppError with descriptive message', () => {
			try {
				sanitizeStoragePath('../path', 's3');
			} catch (error) {
				expect(error).toBeInstanceOf(AppError);
				expect((error as AppError).message).toContain('Directory traversal');
				expect((error as AppError).message).toContain('..');
			}
		});
	});
});
