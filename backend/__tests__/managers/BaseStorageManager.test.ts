import { BaseStorageManager } from '../../src/managers/BaseStorageManager';
import { runRcloneCommand } from '../../src/utils/rclone/rclone';
import { providers } from '../../src/utils/providers';

// Explicit module mocks so we control shapes
jest.mock('../../src/utils/rclone/rclone', () => ({
	runRcloneCommand: jest.fn(),
}));
jest.mock('../../src/utils/providers', () => ({
	providers: {},
}));

// Mock fetch globally
(global as any).fetch = jest.fn();

describe('BaseStorageManager', () => {
	let manager: BaseStorageManager;
	let mockRunRcloneCommand: jest.MockedFunction<typeof runRcloneCommand>;
	let mockFetch: jest.MockedFunction<typeof fetch>;

	beforeEach(() => {
		manager = new BaseStorageManager();
		mockRunRcloneCommand = runRcloneCommand as jest.MockedFunction<typeof runRcloneCommand>;
		mockFetch = fetch as jest.MockedFunction<typeof fetch>;
		// Reset implementations and call history
		jest.resetAllMocks();

		// Reinstall provider mocks after reset
		(providers as any).s3 = {
			setup: jest
				.fn()
				.mockReturnValue(['access_key_id', 'test-key', 'secret_access_key', 'test-secret']),
		};
		(providers as any).onedrive = {
			setup: jest.fn().mockReturnValue(['client_id', 'test-id']),
		};
		// Important: provide a local provider to avoid calling setup on undefined
		(providers as any).local = {
			setup: jest.fn().mockReturnValue([]),
		};
	});

	describe('createRemote', () => {
		it('should create remote successfully', async () => {
			mockRunRcloneCommand
				.mockResolvedValueOnce('Remote created successfully')
				.mockResolvedValueOnce('lsd output');

			const result = await manager.createRemote('s3', 'test-remote', 'credentials', {
				access_key: 'test-key',
				secret_key: 'test-secret',
			});

			expect(mockRunRcloneCommand).toHaveBeenCalledWith([
				'config',
				'create',
				'test-remote',
				's3',
				'access_key_id',
				'test-key',
				'secret_access_key',
				'test-secret',
				'--obscure',
				'--non-interactive',
			]);
			expect(mockRunRcloneCommand).toHaveBeenCalledWith(['lsd', 'test-remote:']);
			expect(result).toEqual({
				success: true,
				result: 'Remote created successfully',
			});
		});

		it('should create local remote without provider', async () => {
			mockRunRcloneCommand
				.mockResolvedValueOnce('Local remote created')
				.mockResolvedValueOnce('lsd output');

			const result = await manager.createRemote('local', 'local-remote', 'none', {});

			expect(mockRunRcloneCommand).toHaveBeenCalledWith([
				'config',
				'create',
				'local-remote',
				'local',
				'--obscure',
				'--non-interactive',
			]);
			expect(result.success).toBe(true);
		});

		it('should add additional settings', async () => {
			mockRunRcloneCommand
				.mockResolvedValueOnce('Remote created')
				.mockResolvedValueOnce('lsd output');

			await manager.createRemote(
				's3',
				'test-remote',
				'credentials',
				{
					access_key: 'test-key',
				},
				{
					region: 'us-east-1',
					endpoint: 'custom-endpoint',
				}
			);

			expect(mockRunRcloneCommand).toHaveBeenCalledWith([
				'config',
				'create',
				'test-remote',
				's3',
				'access_key_id',
				'test-key',
				'secret_access_key',
				'test-secret',
				'region',
				'us-east-1',
				'endpoint',
				'custom-endpoint',
				'--obscure',
				'--non-interactive',
			]);
		});

		it('should handle OneDrive OAuth special case', async () => {
			const mockResponse = {
				json: jest.fn().mockResolvedValue({
					id: 'drive-123',
					driveType: 'personal',
				}),
			};
			mockFetch.mockResolvedValue(mockResponse as any);
			mockRunRcloneCommand
				.mockResolvedValueOnce('OneDrive remote created')
				.mockResolvedValueOnce('lsd output');

			const token = JSON.stringify({ access_token: 'Bearer token123' });
			await manager.createRemote('onedrive', 'onedrive-remote', 'oauth', { token });

			expect(mockFetch).toHaveBeenCalledWith('https://graph.microsoft.com/v1.0/me/drive', {
				method: 'GET',
				headers: expect.any(Headers),
				redirect: 'follow',
			});
			expect(mockRunRcloneCommand).toHaveBeenCalledWith([
				'config',
				'create',
				'onedrive-remote',
				'onedrive',
				'client_id',
				'test-id',
				'drive_id',
				'drive-123',
				'drive_type',
				'personal',
				'--obscure',
				'--non-interactive',
			]);
		});

		it('should handle OneDrive fetch error gracefully', async () => {
			mockFetch.mockRejectedValue(new Error('Network error'));
			mockRunRcloneCommand
				.mockResolvedValueOnce('OneDrive remote created')
				.mockResolvedValueOnce('lsd output');

			const token = JSON.stringify({ access_token: 'Bearer token123' });
			const result = await manager.createRemote('onedrive', 'onedrive-remote', 'oauth', { token });

			expect(result.success).toBe(true);
			expect(mockRunRcloneCommand).toHaveBeenCalledWith([
				'config',
				'create',
				'onedrive-remote',
				'onedrive',
				'client_id',
				'test-id',
				'--obscure',
				'--non-interactive',
			]);
		});

		it('should throw error for unsupported storage type', async () => {
			await expect(manager.createRemote('unsupported', 'test', 'auth', {})).rejects.toThrow(
				'Unsupported storage type: unsupported'
			);
		});

		it('should handle rclone command failure', async () => {
			mockRunRcloneCommand.mockRejectedValueOnce(new Error('Rclone error'));

			const result = await manager.createRemote('s3', 'test-remote', 'credentials', {
				access_key: 'test-key',
			});

			expect(result).toEqual({
				success: false,
				result: 'Rclone error',
			});
		});

		it('should cleanup remote if verification fails', async () => {
			mockRunRcloneCommand
				.mockResolvedValueOnce('Remote created') // config create succeeds
				.mockRejectedValueOnce(new Error('Verification failed')) // lsd fails
				.mockResolvedValueOnce('Remote deleted'); // config delete succeeds

			const result = await manager.createRemote('s3', 'test-remote', 'credentials', {
				access_key: 'test-key',
			});

			expect(mockRunRcloneCommand).toHaveBeenNthCalledWith(1, [
				'config',
				'create',
				'test-remote',
				's3',
				'access_key_id',
				'test-key',
				'secret_access_key',
				'test-secret',
				'--obscure',
				'--non-interactive',
			]);
			expect(mockRunRcloneCommand).toHaveBeenNthCalledWith(2, ['lsd', 'test-remote:']);
			expect(mockRunRcloneCommand).toHaveBeenNthCalledWith(3, ['config', 'delete', 'test-remote']);
			expect(result).toEqual({
				success: false,
				result: 'Verification failed',
			});
		});
	});

	describe('updateRemote', () => {
		it('should update remote successfully', async () => {
			mockRunRcloneCommand
				.mockResolvedValueOnce('Remote updated') // config update succeeds
				.mockResolvedValueOnce('lsd verification'); // verification succeeds

			const result = await manager.updateRemote(
				'test-remote',
				{ region: 'us-west-2', timeout: 30 },
				{ region: 'us-east-1', timeout: 60 }
			);

			expect(mockRunRcloneCommand).toHaveBeenNthCalledWith(1, [
				'config',
				'update',
				'test-remote',
				'region',
				'us-west-2',
				'timeout',
				'30',
				'--non-interactive',
			]);
			expect(mockRunRcloneCommand).toHaveBeenNthCalledWith(2, ['lsd', 'test-remote:']);
			expect(result).toEqual({
				success: true,
				result: 'Remote updated',
			});
		});

		it('should revert settings if verification fails', async () => {
			mockRunRcloneCommand
				.mockResolvedValueOnce('Remote updated') // initial update succeeds
				.mockRejectedValueOnce(new Error('Verification failed')) // verification fails
				.mockResolvedValueOnce('Settings reverted'); // revert succeeds

			const oldSettings = { region: 'us-east-1', timeout: 60 };
			const result = await manager.updateRemote(
				'test-remote',
				{ region: 'us-west-2' },
				oldSettings
			);

			expect(mockRunRcloneCommand).toHaveBeenNthCalledWith(1, [
				'config',
				'update',
				'test-remote',
				'region',
				'us-west-2',
				'--non-interactive',
			]);
			expect(mockRunRcloneCommand).toHaveBeenNthCalledWith(2, ['lsd', 'test-remote:']);
			expect(mockRunRcloneCommand).toHaveBeenNthCalledWith(3, [
				'config',
				'update',
				'test-remote',
				'--non-interactive',
				'region',
				'us-east-1',
				'timeout',
				'60',
			]);
			expect(result).toEqual({
				success: false,
				result: 'Verification failed',
			});
		});

		it('should handle update command failure', async () => {
			mockRunRcloneCommand.mockRejectedValueOnce(new Error('Update failed'));

			const result = await manager.updateRemote('test-remote', { region: 'us-west-2' }, {});

			expect(result).toEqual({
				success: false,
				result: 'Update failed',
			});
		});
	});

	describe('deleteRemote', () => {
		it('should delete remote successfully', async () => {
			mockRunRcloneCommand.mockResolvedValueOnce('Remote deleted');

			const result = await manager.deleteRemote('test-remote');

			expect(mockRunRcloneCommand).toHaveBeenCalledWith(['config', 'delete', 'test-remote']);
			expect(result).toEqual({
				success: true,
				result: 'Remote deleted',
			});
		});

		it('should handle delete failure', async () => {
			mockRunRcloneCommand.mockRejectedValueOnce(new Error('Delete failed'));

			const result = await manager.deleteRemote('test-remote');

			expect(result).toEqual({
				success: false,
				result: 'Delete failed',
			});
		});
	});

	describe('getRemoteConfig', () => {
		it('should parse valid config output', async () => {
			const configOutput = `[test-remote]
type = s3
access_key_id = AKIAIOSFODNN7EXAMPLE
secret_access_key = ********
region = us-east-1`;

			mockRunRcloneCommand.mockResolvedValueOnce(configOutput);

			const result = await manager.getRemoteConfig('test-remote');

			expect(result).toEqual({
				success: true,
				result: {
					name: 'test-remote',
					type: 's3',
					access_key_id: 'AKIAIOSFODNN7EXAMPLE',
					secret_access_key: '********',
					region: 'us-east-1',
				},
			});
		});

		it('should handle values with equals signs', async () => {
			const configOutput = `[test-remote]
type = s3
token = eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9=value=with=equals`;

			mockRunRcloneCommand.mockResolvedValueOnce(configOutput);

			const result = await manager.getRemoteConfig('test-remote');

			expect(result.result.token).toBe('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9=value=with=equals');
		});

		it('should parse error comments', async () => {
			const configOutput = `[test-remote]
# Error: invalid credentials
# Access denied`;

			mockRunRcloneCommand.mockResolvedValueOnce(configOutput);

			const result = await manager.getRemoteConfig('test-remote');

			expect(result).toEqual({
				success: false,
				result: 'Error: invalid credentials # Access denied',
			});
		});

		it('should handle command failure', async () => {
			mockRunRcloneCommand.mockRejectedValueOnce(new Error('Config not found'));

			const result = await manager.getRemoteConfig('test-remote');

			expect(result).toEqual({
				success: false,
				result: 'Config not found',
			});
		});
	});

	describe('verifyRemote', () => {
		it('should verify remote successfully', async () => {
			mockRunRcloneCommand.mockResolvedValueOnce('directory listing');

			const result = await manager.verifyRemote('test-remote');

			expect(mockRunRcloneCommand).toHaveBeenCalledWith(['lsd', 'test-remote:']);
			expect(result).toEqual({
				success: true,
				result: 'directory listing',
			});
		});

		it('should handle verification failure', async () => {
			mockRunRcloneCommand.mockRejectedValueOnce(new Error('Access denied'));

			const result = await manager.verifyRemote('test-remote');

			expect(result).toEqual({
				success: false,
				result: 'Access denied',
			});
		});
	});

	describe('listRemotes', () => {
		it('should list remotes successfully', async () => {
			mockRunRcloneCommand.mockResolvedValueOnce('remote1:\nremote2:\nlocal:');

			const result = await manager.listRemotes();

			expect(mockRunRcloneCommand).toHaveBeenCalledWith(['listremotes']);
			expect(result).toEqual({
				success: true,
				result: 'remote1:\nremote2:\nlocal:',
			});
		});

		it('should handle list failure', async () => {
			mockRunRcloneCommand.mockRejectedValueOnce(new Error('List failed'));

			const result = await manager.listRemotes();

			expect(result).toEqual({
				success: false,
				result: 'List failed',
			});
		});
	});

	describe('browseRemote', () => {
		it('should browse remote successfully', async () => {
			const lsjsonOutput = JSON.stringify([
				{
					Name: 'file1.txt',
					IsDir: false,
					Size: 1024,
					ModTime: '2023-01-01T00:00:00Z',
					Path: 'file1.txt',
				},
				{
					Name: 'folder1',
					IsDir: true,
					Size: 0,
					ModTime: '2023-01-01T00:00:00Z',
					Path: 'folder1',
				},
			]);

			mockRunRcloneCommand.mockResolvedValueOnce(lsjsonOutput);

			const result = await manager.browseRemote('test-remote', '/path');

			expect(mockRunRcloneCommand).toHaveBeenCalledWith(['lsjson', 'test-remote:/path']);
			expect(result).toEqual({
				success: true,
				result: {
					path: '/path',
					items: [
						{
							name: 'file1.txt',
							type: 'file',
							size: 1024,
							modTime: '2023-01-01T00:00:00Z',
							path: 'file1.txt',
						},
						{
							name: 'folder1',
							type: 'dir',
							size: 0,
							modTime: '2023-01-01T00:00:00Z',
							path: 'folder1',
						},
					],
				},
			});
		});

		it('should use default path if not provided', async () => {
			mockRunRcloneCommand.mockResolvedValueOnce('[]');

			await manager.browseRemote('test-remote');

			expect(mockRunRcloneCommand).toHaveBeenCalledWith(['lsjson', 'test-remote:/']);
		});

		it('should handle browse failure', async () => {
			mockRunRcloneCommand.mockRejectedValueOnce(new Error('Browse failed'));

			const result = await manager.browseRemote('test-remote');

			expect(result).toEqual({
				success: false,
				result: 'Browse failed',
			});
		});
	});

	describe('getRemoteFileContent', () => {
		it('should get file content successfully', async () => {
			mockRunRcloneCommand.mockResolvedValueOnce('file content here');

			const result = await manager.getRemoteFileContent('test-remote', '/path/file.txt');

			expect(mockRunRcloneCommand).toHaveBeenCalledWith(['cat', 'test-remote:/path/file.txt']);
			expect(result).toEqual({
				success: true,
				result: 'file content here',
			});
		});

		it('should handle file read failure', async () => {
			mockRunRcloneCommand.mockRejectedValueOnce(new Error('File not found'));

			const result = await manager.getRemoteFileContent('test-remote', '/path/file.txt');

			expect(result).toEqual({
				success: false,
				result: 'File not found',
			});
		});
	});

	describe('getDownloadLink', () => {
		it('should get download link successfully', async () => {
			mockRunRcloneCommand.mockResolvedValueOnce('  https://example.com/download/file.txt  ');

			const result = await manager.getDownloadLink('test-remote', '/path/file.txt');

			expect(mockRunRcloneCommand).toHaveBeenCalledWith(['link', 'test-remote:/path/file.txt']);
			expect(result).toEqual({
				success: true,
				result: 'https://example.com/download/file.txt',
			});
		});

		it('should handle link generation failure', async () => {
			mockRunRcloneCommand.mockRejectedValueOnce(
				new Error('Provider does not support public links')
			);

			const result = await manager.getDownloadLink('test-remote', '/path/file.txt');

			expect(result).toEqual({
				success: false,
				result: 'Provider does not support public links',
			});
		});
	});
});
