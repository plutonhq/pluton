import { SettingsService } from '../../src/services/SettingsService';
jest.mock('../../src/db/index', () => ({ db: {} }));
jest.mock('../../src/services/ConfigService', () => ({
	configService: { config: { SECRET: 'synthetic-config-secret' } },
}));
describe('existing notification settings secret boundary', () => {
	const marker = 'synthetic-private-credential-marker';
	const saved: any = {
		id: 1,
		createdAt: new Date('2026-01-01'),
		settings: {
			title: 'Example',
			integration: {
				smtp: {
					server: 'smtp.example.internal',
					port: 587,
					username: 'notification-user',
					password: marker,
					senderEmail: 'backup@example.invalid',
					connected: true,
				},
				ntfy: { authType: 'token', authToken: marker, connected: true },
			},
			totp: { enabled: true, secret: marker, recoveryCodes: [marker] },
		},
	};
	it('never returns existing SMTP/token/2FA credentials through public read views', async () => {
		const store: any = {
			getFirst: jest.fn().mockResolvedValue(saved),
			getById: jest.fn().mockResolvedValue(saved),
		};
		const service = new SettingsService(store, {} as any);
		for (const view of [await service.getMainSettings(), await service.getSettings(1)]) {
			expect(JSON.stringify(view)).not.toContain(marker);
			expect(view?.settings?.integration.smtp?.password).toBe('');
			expect(view?.settings?.integration.smtp?.passwordConfigured).toBe(true);
			expect(view?.createdAt).toEqual(saved.createdAt);
		}
		expect(saved.settings.integration.smtp.password).toBe(marker);
	});
	it('blank public form saves preserve existing credentials and private 2FA state without rotating or echoing them', async () => {
		const store: any = {
			getById: jest.fn().mockResolvedValue(saved),
			update: jest
				.fn()
				.mockImplementation(async (_id: number, value: any) => ({ ...saved, settings: value })),
		};
		const service = new SettingsService(store, {} as any);
		const view = (await service.getSettings(1))!;
		const result = await service.updateSettings(1, view.settings!);
		expect(store.update.mock.calls[0][1].integration.smtp.password).toBe(marker);
		expect(store.update.mock.calls[0][1].integration.ntfy.authToken).toBe(marker);
		expect(store.update.mock.calls[0][1].totp).toEqual(saved.settings.totp);
		expect(JSON.stringify(result)).not.toContain(marker);
	});
	it('never reflects arbitrary store/provider exception content in settings errors', async () => {
		const store: any = { update: jest.fn().mockRejectedValue(new Error(marker)) };
		const service = new SettingsService(store, {} as any);
		await expect(service.updateSettings(1, { title: 'Example' } as any)).rejects.toThrow(
			'An unexpected error occurred'
		);
		await expect(service.updateSettings(1, { title: 'Example' } as any)).rejects.not.toThrow(
			marker
		);
	});
});
