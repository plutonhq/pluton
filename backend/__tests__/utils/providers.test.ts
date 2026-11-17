import { providers, registerProviderSettings } from '../../src/utils/providers';

describe('providers setup()', () => {
	const base = { host: 'example.com', user: 'bob', pass: 'secret' };
	const baseArgs = ['host', 'example.com', 'user', 'bob', 'pass', 'secret'];

	describe('sftp', () => {
		it('sends the port when one is given', () => {
			expect(providers.sftp.setup({ ...base, port: '2222' })).toEqual([
				...baseArgs,
				'port',
				'2222',
			]);
		});

		it('omits the port when it is blank', () => {
			expect(providers.sftp.setup({ ...base, port: '' })).toEqual(baseArgs);
		});

		it('omits the port when it is absent', () => {
			expect(providers.sftp.setup(base)).toEqual(baseArgs);
		});
	});

	describe('ftp', () => {
		it('sends the port and both TLS switches', () => {
			expect(
				providers.ftp.setup({ ...base, port: '2121', tls: 'true', explicit_tls: 'false' })
			).toEqual([...baseArgs, 'port', '2121', 'tls', 'true', 'explicit_tls', 'false']);
		});

		it('omits the switches that are absent', () => {
			expect(providers.ftp.setup({ ...base, explicit_tls: 'true' })).toEqual([
				...baseArgs,
				'explicit_tls',
				'true',
			]);
		});

		it('converts a boolean switch to a string, because spawn rejects other types', () => {
			const creds = { ...base, port: 2121, tls: true } as unknown as Record<string, string>;
			const args = providers.ftp.setup(creds) as string[];

			expect(args).toEqual([...baseArgs, 'port', '2121', 'tls', 'true']);
			args.forEach(arg => expect(typeof arg).toBe('string'));
		});

		it('keeps a switch that is explicitly false', () => {
			const creds = { ...base, tls: false } as unknown as Record<string, string>;
			expect(providers.ftp.setup(creds)).toEqual([...baseArgs, 'tls', 'false']);
		});
	});

	describe('smb', () => {
		it('sends the port and the domain', () => {
			expect(providers.smb.setup({ ...base, port: '1445', domain: 'ACME' })).toEqual([
				...baseArgs,
				'port',
				'1445',
				'domain',
				'ACME',
			]);
		});

		it('omits both when they are absent', () => {
			expect(providers.smb.setup(base)).toEqual(baseArgs);
		});
	});

	describe('sftp key_file_pass', () => {
		it('sends key_file_pass when it is set', () => {
			expect(providers.sftp.setup({ ...base, key_file_pass: 'kfp' })).toEqual([
				...baseArgs,
				'key_file_pass',
				'kfp',
			]);
		});

		it('omits key_file_pass when it is blank', () => {
			expect(providers.sftp.setup({ ...base, key_file_pass: '' })).toEqual(baseArgs);
		});
	});

	describe('azureblob', () => {
		const creds = { account: 'acc', key: 'k' };
		const args = ['account', 'acc', 'key', 'k'];

		it('sends the secret fields when they are set', () => {
			expect(
				providers.azureblob.setup({
					...creds,
					client_secret: 'cs',
					client_certificate_password: 'ccp',
					password: 'pw',
				})
			).toEqual([
				...args,
				'client_secret',
				'cs',
				'client_certificate_password',
				'ccp',
				'password',
				'pw',
			]);
		});

		it('omits the secret fields when they are blank', () => {
			expect(
				providers.azureblob.setup({
					...creds,
					client_secret: '',
					client_certificate_password: '',
					password: '',
				})
			).toEqual(args);
		});
	});

	describe('drive', () => {
		const sac = '{"type":"service_account"}';

		it('oauth: sends service_account_credentials when set', () => {
			expect(
				providers.drive.setup({ token: 't', service_account_credentials: sac }, 'oauth')
			).toEqual(['token', 't', 'scope', 'drive', 'service_account_credentials', sac]);
		});

		it('oauth: omits service_account_credentials when blank', () => {
			expect(
				providers.drive.setup({ token: 't', service_account_credentials: '' }, 'oauth')
			).toEqual(['token', 't', 'scope', 'drive']);
		});

		it('client: sends service_account_credentials before the client flag', () => {
			expect(
				providers.drive.setup(
					{ client_id: 'id', client_secret: 'sec', service_account_credentials: sac },
					'client'
				)
			).toEqual([
				'client_id',
				'id',
				'client_secret',
				'sec',
				'scope',
				'drive',
				'service_account_credentials',
				sac,
				'--drive-client-credentials',
			]);
		});

		it('client: omits service_account_credentials when absent', () => {
			expect(providers.drive.setup({ client_id: 'id', client_secret: 'sec' }, 'client')).toEqual([
				'client_id',
				'id',
				'client_secret',
				'sec',
				'scope',
				'drive',
				'--drive-client-credentials',
			]);
		});
	});

	describe('gcs', () => {
		it('oauth: sends access_token when set', () => {
			expect(providers.gcs.setup({ token: 't', access_token: 'at' }, 'oauth')).toEqual([
				'token',
				't',
				'access_token',
				'at',
			]);
		});

		it('oauth: omits access_token when blank', () => {
			expect(providers.gcs.setup({ token: 't', access_token: '' }, 'oauth')).toEqual(['token', 't']);
		});

		it('client: sends access_token when set', () => {
			expect(
				providers.gcs.setup(
					{ project_number: '1', service_account_file: '/f.json', access_token: 'at' },
					'client'
				)
			).toEqual(['project_number', '1', 'service_account_file', '/f.json', 'access_token', 'at']);
		});

		it('client: omits access_token when absent', () => {
			expect(
				providers.gcs.setup({ project_number: '1', service_account_file: '/f.json' }, 'client')
			).toEqual(['project_number', '1', 'service_account_file', '/f.json']);
		});
	});

	describe('jottacloud', () => {
		it('password: sends token when set', () => {
			expect(providers.jottacloud.setup({ login_token: 'lt', token: 'tok' }, 'password')).toEqual([
				'config_login_token',
				'lt',
				'config_type',
				'standard',
				'token',
				'tok',
			]);
		});

		it('password: omits token when blank', () => {
			expect(providers.jottacloud.setup({ login_token: 'lt', token: '' }, 'password')).toEqual([
				'config_login_token',
				'lt',
				'config_type',
				'standard',
			]);
		});

		it('client: sends token before the client flag', () => {
			expect(
				providers.jottacloud.setup({ client_id: 'id', client_secret: 'sec', token: 'tok' }, 'client')
			).toEqual([
				'client_id',
				'id',
				'client_secret',
				'sec',
				'token',
				'tok',
				'--jottacloud-client-credentials',
			]);
		});

		it('client: omits token when absent', () => {
			expect(providers.jottacloud.setup({ client_id: 'id', client_secret: 'sec' }, 'client')).toEqual(
				['client_id', 'id', 'client_secret', 'sec', '--jottacloud-client-credentials']
			);
		});
	});

	describe('mailru', () => {
		it('oauth: sends client_secret when set', () => {
			expect(providers.mailru.setup({ token: 't', client_secret: 'cs' }, 'oauth')).toEqual([
				'token',
				't',
				'client_secret',
				'cs',
			]);
		});

		it('oauth: omits client_secret when blank', () => {
			expect(providers.mailru.setup({ token: 't', client_secret: '' }, 'oauth')).toEqual([
				'token',
				't',
			]);
		});

		it('password: sends client_secret when set', () => {
			expect(
				providers.mailru.setup({ user: 'u', pass: 'p', client_secret: 'cs' }, 'password')
			).toEqual(['user', 'u', 'pass', 'p', 'client_secret', 'cs']);
		});

		it('password: omits client_secret when absent', () => {
			expect(providers.mailru.setup({ user: 'u', pass: 'p' }, 'password')).toEqual([
				'user',
				'u',
				'pass',
				'p',
			]);
		});

		it('password: returns false without pass', () => {
			expect(providers.mailru.setup({ user: 'u' }, 'password')).toBe(false);
		});
	});

	describe('protondrive', () => {
		const creds = { username: 'u', password: 'p' };

		it('sends mailbox_password when set', () => {
			expect(providers.protondrive.setup({ ...creds, mailbox_password: 'mp' })).toEqual([
				'username',
				'u',
				'password',
				'p',
				'mailbox_password',
				'mp',
			]);
		});

		it('omits mailbox_password when blank', () => {
			expect(providers.protondrive.setup({ ...creds, mailbox_password: '' })).toEqual([
				'username',
				'u',
				'password',
				'p',
			]);
		});
	});

	describe('seafile', () => {
		const creds = { url: 'https://sf', user: 'u', pass: 'p', library: 'lib' };
		const args = ['url', 'https://sf', 'user', 'u', 'pass', 'p', 'library', 'lib'];

		it('sends auth_token when set', () => {
			expect(providers.seafile.setup({ ...creds, auth_token: 'at' })).toEqual([
				...args,
				'auth_token',
				'at',
			]);
		});

		it('omits auth_token when blank', () => {
			expect(providers.seafile.setup({ ...creds, auth_token: '' })).toEqual(args);
		});
	});

	describe('swift', () => {
		const creds = { user: 'u', key: 'k', auth: 'https://auth', tenant: 't' };
		const args = ['user', 'u', 'key', 'k', 'auth', 'https://auth', 'tenant', 't'];

		it('sends auth_token when set', () => {
			expect(providers.swift.setup({ ...creds, auth_token: 'at' })).toEqual([
				...args,
				'auth_token',
				'at',
			]);
		});

		it('omits auth_token when blank', () => {
			expect(providers.swift.setup({ ...creds, auth_token: '' })).toEqual(args);
		});

		it('omits tenant when blank', () => {
			const result = providers.swift.setup({ ...creds, tenant: '' }) as string[];

			expect(result).toEqual(['user', 'u', 'key', 'k', 'auth', 'https://auth']);
			expect(result).not.toContain(undefined);
		});

		it('password: sends storage_url when set', () => {
			expect(
				providers.swift.setup({ ...creds, storage_url: 'https://store' }, 'password')
			).toEqual([...args, 'storage_url', 'https://store']);
		});

		it.each(['user', 'key', 'auth'])('password: returns false without %s', key => {
			expect(providers.swift.setup({ ...creds, [key]: '' }, 'password')).toBe(false);
		});

		it('client: sends only auth_token and storage_url', () => {
			expect(
				providers.swift.setup(
					{ ...creds, auth_token: 'at', storage_url: 'https://store' },
					'client'
				)
			).toEqual(['auth_token', 'at', 'storage_url', 'https://store']);
		});

		it.each(['auth_token', 'storage_url'])('client: returns false without %s', key => {
			const tokenCreds = { auth_token: 'at', storage_url: 'https://store', [key]: '' };

			expect(providers.swift.setup(tokenCreds, 'client')).toBe(false);
		});

		it('lists password as the default auth type', () => {
			expect(providers.swift.authTypes[0]).toBe('password');
		});
	});

	describe('webdav', () => {
		it('sends user, pass and bearer_token when set', () => {
			expect(
				providers.webdav.setup({ url: 'https://dav', user: 'u', pass: 'p', bearer_token: 'bt' })
			).toEqual(['url', 'https://dav', 'user', 'u', 'pass', 'p', 'bearer_token', 'bt']);
		});

		it('sends only url and bearer_token when user and pass are absent', () => {
			const args = providers.webdav.setup({ url: 'https://dav', bearer_token: 'bt' }) as string[];

			expect(args).toEqual(['url', 'https://dav', 'bearer_token', 'bt']);
			expect(args).not.toContain(undefined);
			expect(args).not.toContain('user');
			expect(args).not.toContain('pass');
		});

		it('omits blank user and pass', () => {
			expect(providers.webdav.setup({ url: 'https://dav', user: '', pass: '' })).toEqual([
				'url',
				'https://dav',
			]);
		});
	});

	describe('secret fields', () => {
		it('gives every password field an authFieldType', () => {
			const missing: string[] = [];
			Object.entries(providers).forEach(([type, provider]) => {
				(provider.settings || []).forEach((field: any) => {
					if (field.fieldType === 'password' && !field.authFieldType) {
						missing.push(`${type}.${field.value}`);
					}
				});
			});
			expect(missing).toEqual([]);
		});
	});
});

describe('registerProviderSettings', () => {
	const field = (value: string) => ({
		label: value,
		value,
		fieldType: 'string',
		required: false,
		default: '',
		description: '',
	});

	it('adds new settings to matched providers only, once', () => {
		const wasabiBefore = providers.wasabi.settings!.length;
		const sftpBefore = providers.sftp.settings?.length || 0;
		const isS3 = (p: { type?: string }) => p.type === 's3';

		registerProviderSettings(isS3, [field('test_extra_key')]);
		registerProviderSettings(isS3, [field('test_extra_key')]);

		expect(providers.wasabi.settings!.length).toBe(wasabiBefore + 1);
		expect(providers.wasabi.settings!.filter(s => s.value === 'test_extra_key')).toHaveLength(1);
		expect(providers.sftp.settings?.length || 0).toBe(sftpBefore);
	});

	it('puts the settings first with prepend', () => {
		registerProviderSettings(p => p.name === 'AWS S3', [field('test_first_key')], { prepend: true });
		expect(providers.s3.settings![0].value).toBe('test_first_key');
	});

	it('does not add a setting the provider already has', () => {
		const before = providers.s3.settings!.length;
		registerProviderSettings(p => p.name === 'AWS S3', [field('region')]);
		expect(providers.s3.settings!.length).toBe(before);
	});
});
