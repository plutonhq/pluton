import {
	addressAllowed,
	parseChannel,
	parseSubscription,
	pinnedAddress,
} from '../../src/notifications/deliveryPolicy';
import { notificationFixture } from '../fixtures/notifications';
const publicPolicy = { network: 'public' as const, allowedCidrs: [] };
const lan = {
	network: 'trusted-lan' as const,
	allowedCidrs: ['192.168.50.0/24', 'fd12:3456::/64'],
};
describe('notification destination policy', () => {
	it.each([
		'127.0.0.1',
		'0.0.0.0',
		'169.254.169.254',
		'100.100.100.200',
		'224.0.0.1',
		'::1',
		'::',
		'fe80::1',
		'::ffff:127.0.0.1',
		'::ffff:c0a8:3201',
		'ff02::1',
		'fd00:ec2::254',
	])('refuses unsafe/metadata address %s even with LAN approval', address => {
		expect(addressAllowed(address, publicPolicy)).toBe(false);
		expect(addressAllowed(address, lan)).toBe(false);
	});
	it('metadata and transition mechanisms cannot bypass protection through approved IPv6 CIDRs', () => {
		expect(
			addressAllowed('fd00:ec2::254', { network: 'trusted-lan', allowedCidrs: ['fd00:ec2::/64'] })
		).toBe(false);
		for (const address of ['2002:7f00:1::1', '2001::1234'])
			expect(addressAllowed(address, publicPolicy)).toBe(false);
	});
	it('allows RFC1918/ULA only in approved narrow private subnets, not arbitrary private or public destinations', () => {
		expect(addressAllowed('192.168.50.20', lan)).toBe(true);
		expect(addressAllowed('192.168.51.20', lan)).toBe(false);
		expect(addressAllowed('192.168.50.20', publicPolicy)).toBe(false);
		expect(addressAllowed('fd12:3456::12', lan)).toBe(true);
		expect(addressAllowed('203.0.113.20', publicPolicy)).toBe(true);
		expect(addressAllowed('203.0.113.20', lan)).toBe(false);
	});
	it.each([
		'http://notify.example.internal',
		'file:///etc/passwd',
		'https://user:secret@notify.example.internal',
		'https://notify.example.internal/?token=secret',
		'https://notify.example.internal/#secret',
		'https://127.1',
		'https://[::1]',
		'https://metadata.google.internal/?value=1',
	])('rejects malformed, credential-bearing or unsafe URL %s', url => {
		const f = notificationFixture();
		try {
			expect(() =>
				parseChannel({ ...f.channel(), config: { ...f.channel().config, url } })
			).toThrow();
		} finally {
			f.sqlite.close();
		}
	});
	it('supports explicitly approved trusted-LAN HTTP, but rejects broad/private policy bypasses', () => {
		const f = notificationFixture();
		try {
			expect(
				parseChannel({
					...f.channel(),
					config: { url: 'http://192.168.50.20/events', timeoutMs: 1000, ...lan },
				})
			).toBeTruthy();
			for (const allowedCidrs of [
				['0.0.0.0/0'],
				['192.168.0.0/8'],
				['127.0.0.1/32'],
				['203.0.113.20/32'],
				[],
			])
				expect(() =>
					parseChannel({
						...f.channel(),
						config: {
							url: 'http://192.168.50.20/events',
							timeoutMs: 1000,
							network: 'trusted-lan',
							allowedCidrs,
						},
					})
				).toThrow();
		} finally {
			f.sqlite.close();
		}
	});
	it('pins a validated DNS answer and refuses mixed/rebound answers or timeout without a second connection lookup', async () => {
		const resolver = jest.fn().mockResolvedValue([{ address: '192.168.50.20', family: 4 }]);
		expect(
			await pinnedAddress('notify.example.internal', lan, AbortSignal.timeout(1000), resolver)
		).toEqual({ address: '192.168.50.20', family: 4 });
		expect(resolver).toHaveBeenCalledTimes(1);
		resolver.mockResolvedValue([
			{ address: '192.168.50.20', family: 4 },
			{ address: '169.254.169.254', family: 4 },
		]);
		await expect(
			pinnedAddress('notify.example.internal', lan, AbortSignal.timeout(1000), resolver)
		).rejects.toMatchObject({ code: 'unsafe-destination' });
		resolver.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
		await expect(
			pinnedAddress('notify.example.internal', lan, AbortSignal.timeout(1000), resolver)
		).rejects.toMatchObject({ code: 'unsafe-destination' });
		await expect(
			pinnedAddress('notify.example.internal', lan, AbortSignal.abort(), resolver)
		).rejects.toMatchObject({ code: 'delivery-timeout' });
	});
	it('rejects header injection, invalid recipients, insecure public SMTP and unknown arbitrary settings', () => {
		const f = notificationFixture();
		try {
			const smtp = f.channel('smtp') as any;
			for (const config of [
				{ ...smtp.config, senderName: 'Name\r\nBcc: injected@example.invalid' },
				{ ...smtp.config, recipients: ['bad\r\naddress'] },
				{ ...smtp.config, security: 'plain' },
				{ ...smtp.config, tls: { rejectUnauthorized: false } },
				{ ...smtp.config, host: 'smtp..internal' },
			])
				expect(() => parseChannel({ ...smtp, config })).toThrow();
			expect(() =>
				parseSubscription({ enabled: true, channelIds: [], events: ['backup.completed'] })
			).toThrow();
			expect(() =>
				parseSubscription({
					enabled: true,
					channelIds: ['nc_' + 'a'.repeat(32)],
					events: ['shell.exec'],
				})
			).toThrow();
		} finally {
			f.sqlite.close();
		}
	});
});
