import Cryptr from 'cryptr';
import { PlanService } from '../../src/services/PlanService';

jest.mock('../../src/services/ConfigService', () => ({
	configService: { config: { SECRET: 'synthetic-phase5-plan-secret' } },
}));

const database = {
	engine: 'mariadb',
	host: 'localhost',
	port: 3306,
	tls: 'local',
	database: 'example_db',
	username: 'backup_reader',
	dumpFilename: 'app.sql',
	timeoutSeconds: 60,
	maxDumpBytes: 1024 ** 3,
	includeRoutines: false,
	includeEvents: false,
	password: 'test-only-db-password',
};
const planInput = () =>
	({
		title: 'Example plan',
		storage: { id: 'sftp-01', name: 'Example storage' },
		storagePath: 'managed/app-01',
		sourceId: 'agent-01',
		sourceType: 'device',
		method: 'backup',
		sourceConfig: { includes: ['/srv/example-app'], excludes: [] },
		tags: [],
		settings: {
			encryption: true,
			interval: { type: 'daily', time: '01:00AM' },
			remoteLifecycle: { version: 1, database },
		},
	}) as any;

describe('Phase 5 plan write/read secret boundary', () => {
	let store: any;
	let remote: any;
	let service: PlanService;
	beforeEach(() => {
		store = {
			create: jest.fn().mockImplementation(async data => data),
			delete: jest.fn(),
			update: jest.fn().mockImplementation(async (id, data) => ({ id, ...data })),
			getById: jest.fn(),
			getAll: jest.fn(),
			getDatabaseCredential: jest.fn(),
			getDatabaseCredentials: jest.fn().mockResolvedValue([]),
			hasActiveBackups: jest.fn().mockResolvedValue(false),
		};
		remote = {
			validatePlanCreation: jest.fn(),
			createManagedPlan: jest.fn(),
			updateManagedPlan: jest.fn(),
		};
		service = new PlanService(
			{} as any,
			store,
			{} as any,
			{
				getById: jest
					.fn()
					.mockResolvedValue({ id: 'sftp-01', name: 'Example storage', type: 'sftp' }),
			} as any,
			{ getById: jest.fn().mockResolvedValue({ platform: 'linux' }) } as any,
			{} as any,
			remote
		);
	});
	it('create returns only public settings, persists ciphertext via atomic store API and never sends input to logs', async () => {
		const input = planInput();
		const result = await service.createPlan(input, { runNow: false });
		expect(JSON.stringify(result)).not.toContain(database.password);
		const [saved, encrypted] = store.create.mock.calls[0];
		expect(saved.settings.remoteLifecycle).toMatchObject({
			version: 2,
			databases: [{ databaseId: expect.stringMatching(/^db_/), passwordConfigured: true }],
		});
		expect(saved.settings.remoteLifecycle.databases[0]).not.toHaveProperty('password');
		expect(new Cryptr('synthetic-phase5-plan-secret').decrypt(encrypted[0].encryptedPassword)).toBe(
			database.password
		);
		store.getById.mockResolvedValue(result);
		store.getAll.mockResolvedValue([result]);
		expect(JSON.stringify(await service.getPlan(result.id))).not.toContain(
			encrypted[0].encryptedPassword
		);
		expect(JSON.stringify(await service.getAllPlans())).not.toContain(
			encrypted[0].encryptedPassword
		);
	});
	it('blank replacement preserves secret; scheduling failure rolls plan and credential back together', async () => {
		const result = await service.createPlan(planInput(), { runNow: false });
		const encrypted = store.create.mock.calls[0][1];
		store.getById.mockResolvedValue(result);
		store.getDatabaseCredentials.mockResolvedValue(encrypted);
		await service.updatePlan(result.id, { settings: result.settings });
		expect(store.update).toHaveBeenLastCalledWith(result.id, expect.any(Object), encrypted);
		remote.updateManagedPlan.mockRejectedValueOnce(new Error('synthetic schedule failure'));
		await expect(service.updatePlan(result.id, { settings: planInput().settings })).rejects.toThrow(
			'synthetic schedule failure'
		);
		expect(store.update).toHaveBeenLastCalledWith(result.id, result, encrypted);
	});
	it('refuses lifecycle on a local plan and config changes during an active remote backup', async () => {
		await expect(service.createPlan({ ...planInput(), sourceId: 'main' })).rejects.toThrow(
			'only for remote'
		);
		const result = await service.createPlan(planInput(), { runNow: false });
		store.getById.mockResolvedValue(result);
		store.hasActiveBackups.mockResolvedValue(true);
		await expect(service.updatePlan(result.id, { settings: result.settings })).rejects.toThrow(
			'active backup'
		);
		expect(store.update).not.toHaveBeenCalled();
	});
	it('disabling all lifecycle settings erases the saved credential and returns to filesystem-only settings', async () => {
		const result = await service.createPlan(planInput(), { runNow: false });
		store.getById.mockResolvedValue(result);
		store.getDatabaseCredentials.mockResolvedValue(store.create.mock.calls[0][1]);
		const { remoteLifecycle: _removed, ...filesystemOnly } = result.settings;
		await service.updatePlan(result.id, {
			settings: { ...filesystemOnly, remoteLifecycle: { version: 2, databases: [] } },
		});
		expect(store.update).toHaveBeenLastCalledWith(
			result.id,
			expect.objectContaining({ settings: { ...filesystemOnly, remoteLifecycle: undefined } }),
			[]
		);
	});
	it('unrelated partial settings and title updates preserve saved database identity and ciphertext', async () => {
		const result = await service.createPlan(planInput(), { runNow: false });
		const credentials = store.create.mock.calls[0][1];
		store.getById.mockResolvedValue(result);
		store.getDatabaseCredentials.mockResolvedValue(credentials);
		await service.updatePlan(result.id, { settings: { compression: true } as any });
		expect(store.update).toHaveBeenLastCalledWith(
			result.id,
			expect.objectContaining({ settings: { ...result.settings, compression: true } })
		);
		expect(store.getDatabaseCredentials).not.toHaveBeenCalled();
		await service.updatePlan(result.id, { title: 'Unrelated title' });
		expect(store.update.mock.calls.at(-1)).toHaveLength(2);
	});
});
