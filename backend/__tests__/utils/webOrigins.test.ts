import type { Request } from 'express';
import { parseWebOrigins, requestWebOrigin, sameOriginJson } from '../../src/utils/webOrigins';
const publicOrigin = 'https://pluton.example.internal',
	privateOrigin = 'http://192.0.2.10:5173';
const policy = parseWebOrigins({
	APP_URL: publicOrigin,
	APP_ALLOWED_ORIGINS: publicOrigin + ',' + privateOrigin,
});
const req = (host: string, origin: string, extra = {}) =>
	({ headers: { host, origin, 'content-type': 'application/json', ...extra } }) as Request;
describe('Explicit web origin configuration', () => {
	it('preserves a single canonical APP_URL and normalizes explicit default ports', () => {
		expect(parseWebOrigins({ APP_URL: 'HTTPS://PLUTON.EXAMPLE.INTERNAL:443/' })).toEqual({
			canonical: publicOrigin,
			origins: [publicOrigin],
		});
		expect(parseWebOrigins({ APP_URL: 'http://localhost:80' }).canonical).toBe('http://localhost');
		expect(policy.origins).toEqual([publicOrigin, privateOrigin]);
	});
	it.each([
		'*',
		'https://*.example.internal',
		'https://user:synthetic@pluton.example.internal',
		'https://pluton.example.internal/path',
		'https://pluton.example.internal?query=1',
		'https://pluton.example.internal#fragment',
		'//pluton.example.internal',
		'file:///tmp',
		'https://pluton.example.internal,',
		'https://pluton.example.internal,https://pluton.example.internal:443',
		'https://pluton.example.internal,http://pluton.example.internal',
		'http://external.example.invalid',
		'https://pluton.example.internal\\evil',
		'https://pluton.example.internal//',
		'https://pluton.example.internal/#',
		'https://%70luton.example.internal',
		'https://pluton.example.internal:70000',
	])('rejects unsafe/ambiguous additional origins: %s', value => {
		expect(() => parseWebOrigins({ APP_URL: publicOrigin, APP_ALLOWED_ORIGINS: value })).toThrow(
			'Invalid APP_URL or APP_ALLOWED_ORIGINS'
		);
	});
	it('does not reflect invalid credential values in startup errors and bounds the list', () => {
		try {
			parseWebOrigins({ APP_URL: 'https://user:never-echo-synthetic@pluton.example.internal' });
		} catch (error) {
			expect(String(error)).not.toContain('never-echo-synthetic');
		}
		expect(() =>
			parseWebOrigins({
				APP_URL: publicOrigin,
				APP_ALLOWED_ORIGINS: Array.from(
					{ length: 9 },
					(_, i) => 'https://app-' + i + '.example.internal'
				).join(','),
			})
		).toThrow();
		expect(() =>
			parseWebOrigins({ APP_URL: publicOrigin, APP_ALLOWED_ORIGINS: 12 as any })
		).toThrow();
	});
});
describe('Fixed approved authority mapping, not a forwarded-header trust policy', () => {
	it('accepts public TLS termination and authorized private HTTP with or without consistent proxy headers', () => {
		expect(sameOriginJson(req('pluton.example.internal', publicOrigin), policy)).toBe(true);
		expect(
			sameOriginJson(
				req('pluton.example.internal:443', publicOrigin, {
					'x-forwarded-proto': 'https',
					'x-forwarded-host': 'pluton.example.internal',
					'x-forwarded-port': '443',
				}),
				policy
			)
		).toBe(true);
		expect(sameOriginJson(req('192.0.2.10:5173', privateOrigin), policy)).toBe(true);
	});
	it.each([
		['192.0.2.10:5173', publicOrigin, {}],
		['pluton.example.internal', privateOrigin, {}],
		['attacker.example.invalid', 'https://attacker.example.invalid', {}],
		[
			'attacker.example.invalid',
			publicOrigin,
			{ 'x-forwarded-host': 'pluton.example.internal', 'x-forwarded-proto': 'https' },
		],
		['192.0.2.10:5173', privateOrigin, { 'x-forwarded-proto': 'https' }],
		['pluton.example.internal', publicOrigin, { 'x-forwarded-host': 'attacker.example.invalid' }],
		[
			'pluton.example.internal',
			publicOrigin,
			{ 'x-forwarded-host': 'pluton.example.internal, attacker.example.invalid' },
		],
		['pluton.example.internal', publicOrigin, { 'x-forwarded-proto': 'https,http' }],
		['pluton.example.internal', publicOrigin, { 'x-forwarded-port': '80' }],
		['pluton.example.internal', publicOrigin, { 'content-type': 'text/plain' }],
		['pluton.example.internal', publicOrigin, { 'sec-fetch-site': 'cross-site' }],
		['pluton.example.internal', 'null', {}],
		['pluton.example.internal', publicOrigin + '/', {}],
	])('refuses forged/cross-origin request %s -> %s', (host, origin, extra) => {
		expect(sameOriginJson(req(host, origin, extra), policy)).toBe(false);
	});
	it('does not silently authorize HTTP or a new authority from request headers', () => {
		const single = parseWebOrigins({ APP_URL: publicOrigin });
		expect(requestWebOrigin(req('192.0.2.10:5173', privateOrigin), single)).toBeNull();
		expect(
			sameOriginJson(
				req('pluton.example.internal', 'http://pluton.example.internal', {
					'x-forwarded-proto': 'http',
				}),
				single
			)
		).toBe(false);
	});
	it('rejects duplicate Host headers and never uses Express forwarded-derived protocol/hostname', () => {
		const input = req('pluton.example.internal', publicOrigin);
		input.rawHeaders = ['Host', 'pluton.example.internal', 'Host', 'attacker.example.invalid'];
		expect(requestWebOrigin(input, policy)).toBeNull();
		Object.defineProperty(input, 'protocol', {
			get() {
				throw new Error('untrusted protocol read');
			},
		});
		Object.defineProperty(input, 'hostname', {
			get() {
				throw new Error('untrusted hostname read');
			},
		});
		input.rawHeaders = [];
		expect(requestWebOrigin(input, policy)).toBe(publicOrigin);
	});
});
