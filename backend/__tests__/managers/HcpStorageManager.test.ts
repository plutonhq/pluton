import { BaseStorageManager } from '../../src/managers/BaseStorageManager';
import { runRcloneCommand } from '../../src/utils/rclone/rclone';

jest.mock('../../src/utils/rclone/rclone', () => ({ runRcloneCommand: jest.fn() }));
jest.mock('../../src/services/ConfigService', () => ({
	configService: { config: { SECRET: 'synthetic-storage-secret' } },
}));

const command = runRcloneCommand as jest.MockedFunction<typeof runRcloneCommand>;
const credentials = {
	endpoint: 'https://tenant.example.internal',
	bucket: 'fixture-bucket',
	access_key_id: 'synthetic-access',
	secret_access_key: 'synthetic-secret',
	session_token: 'synthetic-token',
};
describe('HCP existing namespace configuration', () => {
	beforeEach(() => {
		command.mockReset();
		command.mockResolvedValue('');
	});
	it.each(['s3compatible', 's3'])('keeps %s secrets out of argv and shared config; only named verification process receives them', async type => {
		const result = await new BaseStorageManager().createRemote(
			type,
			'mirror_01',
			'client',
			credentials,
			{ hcp_mode: true, force_path_style: 'false' }
		);
		expect(result.success).toBe(true);
		const [configuration, verification] = command.mock.calls;
		expect(JSON.stringify(configuration)).not.toContain('synthetic-secret');
		expect(configuration[0]).toEqual(
			expect.arrayContaining(['no_check_bucket', 'true', 'force_path_style', 'false'])
		);
		expect(configuration[0]).not.toContain('--obscure');
		expect(verification[0]).toEqual(['lsd', 'mirror_01:fixture-bucket']);
		expect(verification[1]).toMatchObject({
			RCLONE_CONFIG_MIRROR_01_SECRET_ACCESS_KEY: credentials.secret_access_key,
			RCLONE_CONFIG_MIRROR_01_SESSION_TOKEN: credentials.session_token,
		});
		expect(command.mock.calls.flatMap(call => call[0])).not.toContain('mkdir');
	});
	it('preserves AWS provider identity and clears legacy secret config during protected updates', async () => {
		const settings = { ...credentials, hcp_mode: true, _pluton_storage_type: 's3' };
		const result = await new BaseStorageManager().updateRemote('aws_01', settings, settings);
		expect(result.success).toBe(true);
		const [configuration, verification] = command.mock.calls;
		expect(configuration[0]).toEqual(expect.arrayContaining(['config', 'update', 'aws_01', 'provider', 'AWS', 'secret_access_key', '']));
		expect(JSON.stringify(configuration)).not.toContain('synthetic-secret');
		expect(verification[1]).toMatchObject({ RCLONE_CONFIG_AWS_01_SECRET_ACCESS_KEY: credentials.secret_access_key });
	});
	it('does not expose provider errors/credentials or claim successful creation on denied access', async () => {
		command
			.mockResolvedValueOnce('')
			.mockRejectedValueOnce(new Error(`Forbidden ${credentials.secret_access_key}`));
		const result = await new BaseStorageManager().createRemote(
			's3compatible',
			'mirror_01',
			'client',
			credentials,
			{ hcp_mode: true }
		);
		expect(result.success).toBe(false);
		expect(result.result).not.toContain(credentials.secret_access_key);
		expect(command).toHaveBeenLastCalledWith(['config', 'delete', 'mirror_01']);
	});
	it('never executes a process for insecure endpoints or user-controlled trust paths', async () => {
		await expect(
			new BaseStorageManager().createRemote(
				's3compatible',
				'mirror_01',
				'client',
				{ ...credentials, endpoint: 'http://tenant.example.internal' },
				{ hcp_mode: true }
			)
		).rejects.toHaveProperty('statusCode', 400);
		await expect(
			new BaseStorageManager().createRemote('s3compatible', 'mirror_01', 'client', credentials, {
				hcp_mode: true,
				ca_cert: '/arbitrary/ca.pem',
			})
		).rejects.toHaveProperty('statusCode', 400);
		expect(command).not.toHaveBeenCalled();
	});
});
