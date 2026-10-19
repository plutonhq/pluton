import { BlockList, isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { z } from 'zod';
import { AppError } from '../utils/AppError';
import {
	notificationEvents,
	type ChannelInput,
	type NetworkPolicy,
	type Subscription,
} from '../types/notificationDelivery';

const safeText = (max: number) =>
	z
		.string()
		.max(max)
		.refine(
			value =>
				!Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
		);
const eventList = z
	.array(z.enum(notificationEvents))
	.max(8)
	.transform(values => [...new Set(values)]);
const network = {
	network: z.enum(['public', 'trusted-lan']),
	allowedCidrs: z.array(z.string().max(80)).max(8),
};
const common = {
	name: safeText(120).min(1),
	enabled: z.boolean(),
	events: eventList,
	secret: z.string().max(4096).optional(),
};
const channelSchema = z.discriminatedUnion('kind', [
	z
		.object({
			...common,
			kind: z.literal('webhook'),
			config: z
				.object({
					...network,
					url: safeText(2048).min(1),
					timeoutMs: z.number().int().min(1000).max(30000),
				})
				.strict(),
		})
		.strict(),
	z
		.object({
			...common,
			kind: z.literal('smtp'),
			config: z
				.object({
					...network,
					host: safeText(253).min(1),
					port: z.number().int().min(1).max(65535),
					security: z.enum(['plain', 'starttls', 'tls']),
					username: safeText(256),
					senderEmail: z.email().max(254),
					senderName: safeText(120),
					recipients: z.array(z.email().max(254)).min(1).max(20),
					timeoutMs: z.number().int().min(1000).max(30000),
				})
				.strict(),
		})
		.strict(),
]);
const subscriptionSchema = z
	.object({
		enabled: z.boolean(),
		channelIds: z.array(z.string().regex(/^nc_[a-f0-9]{32}$/)).max(32),
		events: eventList,
	})
	.strict();
function invalid(): never {
	throw new AppError(
		400,
		'Invalid notification configuration. Check field formats, TLS mode and approved private CIDRs.'
	);
}
export function parseSubscription(value: unknown): Subscription {
	const result = subscriptionSchema.safeParse(value);
	if (
		!result.success ||
		(result.data.enabled && (!result.data.events.length || !result.data.channelIds.length))
	)
		invalid();
	return { ...result.data, channelIds: [...new Set(result.data.channelIds)] };
}
// Keep families separate: Node also checks IPv4 against mapped IPv6 rules.
// A mixed BlockList containing ::ffff:0:0/96 would reject EVERY ordinary IPv4.
const forbidden4 = new BlockList(),
	forbidden6 = new BlockList();
for (const [address, prefix] of [
	['0.0.0.0', 8],
	['127.0.0.0', 8],
	['169.254.0.0', 16],
	['100.64.0.0', 10],
	['192.0.0.0', 24],
	['198.18.0.0', 15],
	['224.0.0.0', 4],
	['240.0.0.0', 4],
] as const)
	forbidden4.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
	['::', 96],
	['::ffff:0:0', 96],
	['fe80::', 10],
	['ff00::', 8],
	['2002::', 16],
	['2001::', 32],
] as const)
	forbidden6.addSubnet(address, prefix, 'ipv6');
forbidden6.addAddress('fd00:ec2::254', 'ipv6'); // IPv6 instance-metadata endpoint, not an ordinary LAN target.
const privateAddresses = new BlockList();
privateAddresses.addSubnet('10.0.0.0', 8, 'ipv4');
privateAddresses.addSubnet('172.16.0.0', 12, 'ipv4');
privateAddresses.addSubnet('192.168.0.0', 16, 'ipv4');
privateAddresses.addSubnet('fc00::', 7, 'ipv6');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
function family(address: string): 'ipv4' | 'ipv6' {
	return isIP(address) === 4 ? 'ipv4' : 'ipv6';
}
function approvedNetworks(policy: NetworkPolicy): BlockList {
	const list = new BlockList();
	if (policy.network === 'public' && policy.allowedCidrs.length) invalid();
	if (policy.network === 'trusted-lan' && !policy.allowedCidrs.length) invalid();
	for (const cidr of policy.allowedCidrs) {
		const [address, prefixText, extra] = cidr.split('/');
		const version = isIP(address);
		const prefix = Number(prefixText);
		if (
			!version ||
			extra !== undefined ||
			!/^\d+$/.test(prefixText || '') ||
			!Number.isInteger(prefix) ||
			prefix < (version === 4 ? 16 : 48) ||
			prefix > (version === 4 ? 32 : 128) ||
			!privateAddresses.check(address, family(address))
		)
			invalid();
		list.addSubnet(address, prefix, family(address));
	}
	return list;
}
export function addressAllowed(address: string, policy: NetworkPolicy): boolean {
	if (
		!isIP(address) ||
		address.includes('%') ||
		(isIP(address) === 4 ? forbidden4 : forbidden6).check(address, family(address))
	)
		return false;
	const approved = approvedNetworks(policy);
	if (privateAddresses.check(address, family(address)))
		return policy.network === 'trusted-lan' && approved.check(address, family(address));
	return policy.network === 'public' && (isIP(address) === 4 || globalV6.check(address, 'ipv6'));
}
export function webhookUrl(value: string, policy: NetworkPolicy): URL {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		invalid();
	}
	if (
		!['http:', 'https:'].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		(url.protocol === 'http:' && policy.network !== 'trusted-lan')
	)
		invalid();
	const host = url.hostname.replace(/^\[|\]$/g, '');
	if (!validHost(host) || (isIP(host) && !addressAllowed(host, policy))) invalid();
	return url;
}
function validHost(host: string): boolean {
	return (
		host.length <= 253 &&
		!host.includes('%') &&
		!host.endsWith('.') &&
		!/^(localhost|.*\.localhost|.*\.local)$/i.test(host) &&
		!!(
			isIP(host) ||
			host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
		)
	);
}
export function parseChannel(value: unknown): ChannelInput {
	const result = channelSchema.safeParse(value);
	if (!result.success)
		throw new AppError(
			400,
			'Invalid notification fields: ' +
				[
					...new Set(
						result.error.issues.map(
							issue =>
								issue.path
									.map(part => (typeof part === 'number' ? 'entry' : String(part)))
									.join('.') || 'channel'
						)
					),
				]
					.slice(0, 10)
					.join(', ') +
				'. Check their formats; secret values are never returned.'
		);
	const channel = result.data;
	approvedNetworks(channel.config);
	if (channel.kind === 'webhook') webhookUrl(channel.config.url, channel.config);
	else if (
		!validHost(channel.config.host) ||
		(isIP(channel.config.host) && !addressAllowed(channel.config.host, channel.config)) ||
		(channel.config.security === 'plain' && channel.config.network !== 'trusted-lan')
	)
		invalid();
	return channel;
}
export class DestinationError extends Error {
	constructor(public code: 'unsafe-destination' | 'dns-failed' | 'delivery-timeout') {
		super(code);
	}
}
export type ResolveHost = (host: string) => Promise<{ address: string; family: number }[]>;
export const resolveHost: ResolveHost = host => lookup(host, { all: true, verbatim: true });
/** Resolve once, validate EVERY address, then pin the connection to one approved IP. */
export async function pinnedAddress(
	host: string,
	policy: NetworkPolicy,
	signal: AbortSignal,
	resolver: ResolveHost = resolveHost
) {
	if (signal.aborted) throw new DestinationError('delivery-timeout');
	let abort: (() => void) | undefined;
	try {
		const answers = await Promise.race([
			isIP(host) ? Promise.resolve([{ address: host, family: isIP(host) }]) : resolver(host),
			new Promise<never>((_, reject) => {
				abort = () => reject(new DestinationError('delivery-timeout'));
				signal.addEventListener('abort', abort, { once: true });
			}),
		]);
		if (
			!answers.length ||
			answers.length > 32 ||
			answers.some(answer => !addressAllowed(answer.address, policy))
		)
			throw new DestinationError('unsafe-destination');
		return answers[0];
	} catch (error) {
		if (error instanceof DestinationError) throw error;
		throw new DestinationError('dns-failed');
	} finally {
		if (abort) signal.removeEventListener('abort', abort);
	}
}
