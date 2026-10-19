import type { Database } from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import Cryptr from 'cryptr';
import { AppError } from '../utils/AppError';
import { parseChannel, parseSubscription } from '../notifications/deliveryPolicy';
import { terminalPayload } from '../notifications/terminalPayload';
import {
	deliveryMessages,
	type Channel,
	type ChannelInput,
	type Delivery,
	type DeliveryResult,
	type NotificationPayload,
	type Subscription,
} from '../types/notificationDelivery';
type Row = Record<string, any>;
const id = (prefix: string) => `${prefix}_${randomBytes(16).toString('hex')}`;
const maxPending = 10000,
	maxHistory = 20000;
export class NotificationDeliveryStore {
	private cipher: Cryptr;
	constructor(
		private sqlite: Database,
		secret: string,
		private clock: () => number = Date.now
	) {
		this.cipher = new Cryptr(secret);
	}
	private floor(): number {
		return (
			this.sqlite
				.prepare('SELECT COALESCE(MAX(id),0) AS value FROM notification_sources')
				.get() as Row
		).value;
	}
	private channelRow(channelId: string): Row | undefined {
		return this.sqlite.prepare('SELECT * FROM notification_channels WHERE id=?').get(channelId) as
			| Row
			| undefined;
	}
	private view(row: Row): Channel {
		return {
			id: row.id,
			name: row.name,
			kind: row.kind,
			enabled: !!row.enabled,
			deleted: !!row.deleted,
			events: JSON.parse(row.events),
			config: JSON.parse(row.config),
			revision: row.revision,
			sourceFloor: row.source_floor,
			secretConfigured: !!row.encrypted_secret,
		} as Channel;
	}
	channels(): Channel[] {
		return (
			this.sqlite
				.prepare('SELECT * FROM notification_channels WHERE deleted=0 ORDER BY created_at,id')
				.all() as Row[]
		).map(row => this.view(row));
	}
	channel(channelId: string): Channel | undefined {
		const row = this.channelRow(channelId);
		return row && this.view(row);
	}
	channelSecret(channelId: string): string | undefined {
		const row = this.channelRow(channelId);
		return row?.encrypted_secret ? this.cipher.decrypt(row.encrypted_secret) : undefined;
	}
	saveChannel(input: unknown, channelId?: string): Channel {
		const value: ChannelInput = parseChannel(input);
		return this.sqlite.transaction(() => {
			const saved = channelId ? this.channelRow(channelId) : undefined;
			if (channelId && (!saved || saved.deleted))
				throw new AppError(404, 'Notification channel not found.');
			if (saved && saved.kind !== value.kind)
				throw new AppError(400, 'Channel type cannot be changed. Create a new channel.');
			if (!saved && this.channels().length >= 32)
				throw new AppError(409, 'A maximum of 32 notification channels is supported.');
			const secret =
				value.secret === undefined
					? saved?.encrypted_secret || null
					: value.secret
						? this.cipher.encrypt(value.secret)
						: null;
			if (value.kind === 'smtp' && value.config.username && !secret)
				throw new AppError(400, 'SMTP authentication requires a saved password.');
			const channel = channelId || id('nc');
			const now = this.clock();
			if (saved)
				this.sqlite
					.prepare(
						'UPDATE notification_channels SET name=?,enabled=?,events=?,config=?,encrypted_secret=?,revision=revision+1,source_floor=?,updated_at=? WHERE id=?'
					)
					.run(
						value.name,
						+value.enabled,
						JSON.stringify(value.events),
						JSON.stringify(value.config),
						secret,
						!saved.enabled && value.enabled ? this.floor() : saved.source_floor,
						now,
						channel
					);
			else
				this.sqlite
					.prepare(
						'INSERT INTO notification_channels(id,name,kind,enabled,events,config,encrypted_secret,source_floor,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
					)
					.run(
						channel,
						value.name,
						value.kind,
						+value.enabled,
						JSON.stringify(value.events),
						JSON.stringify(value.config),
						secret,
						this.floor(),
						now,
						now
					);
			return this.channel(channel)!;
		})();
	}
	deleteChannel(channelId: string): void {
		this.sqlite.transaction(() => {
			if (
				!this.sqlite
					.prepare(
						'UPDATE notification_channels SET deleted=1,enabled=0,encrypted_secret=NULL,revision=revision+1,updated_at=? WHERE id=? AND deleted=0'
					)
					.run(this.clock(), channelId).changes
			)
				throw new AppError(404, 'Notification channel not found.');
			for (const row of this.sqlite
				.prepare('SELECT * FROM notification_subscriptions')
				.all() as Row[]) {
				const ids = JSON.parse(row.channel_ids).filter((value: string) => value !== channelId);
				this.sqlite
					.prepare('UPDATE notification_subscriptions SET channel_ids=?,enabled=? WHERE plan_id=?')
					.run(JSON.stringify(ids), ids.length ? row.enabled : 0, row.plan_id);
			}
		})();
	}
	subscription(planId: string): Subscription {
		this.requirePlan(planId);
		const row = this.sqlite
			.prepare('SELECT * FROM notification_subscriptions WHERE plan_id=?')
			.get(planId) as Row | undefined;
		return row
			? {
					enabled: !!row.enabled,
					channelIds: JSON.parse(row.channel_ids),
					events: JSON.parse(row.events),
				}
			: { enabled: false, channelIds: [], events: [] };
	}
	private requirePlan(planId: string) {
		if (!this.sqlite.prepare('SELECT id FROM plans WHERE id=?').get(planId))
			throw new AppError(404, 'Backup plan not found.');
	}
	deliveryPolicyError(
		row: Pick<Delivery, 'planId' | 'channelId' | 'eventType'>
	): 'plan-removed' | 'subscription-disabled' | undefined {
		if (!row.planId) return undefined;
		if (!this.sqlite.prepare('SELECT id FROM plans WHERE id=?').get(row.planId))
			return 'plan-removed';
		const policy = this.subscription(row.planId);
		return !policy.enabled ||
			!policy.channelIds.includes(row.channelId) ||
			!policy.events.includes(row.eventType as any)
			? 'subscription-disabled'
			: undefined;
	}
	saveSubscription(planId: string, input: unknown): Subscription {
		const value = parseSubscription(input);
		return this.sqlite.transaction(() => {
			this.requirePlan(planId);
			if (
				value.channelIds.some(
					channelId => !this.channel(channelId) || this.channel(channelId)!.deleted
				)
			)
				throw new AppError(400, 'Select existing notification channels.');
			const saved = this.sqlite
				.prepare('SELECT * FROM notification_subscriptions WHERE plan_id=?')
				.get(planId) as Row | undefined;
			const ids = JSON.stringify([...value.channelIds].sort());
			const events = JSON.stringify([...value.events].sort());
			const changed =
				!saved || !saved.enabled || saved.channel_ids !== ids || saved.events !== events;
			this.sqlite
				.prepare(
					'INSERT INTO notification_subscriptions(plan_id,enabled,channel_ids,events,source_floor) VALUES (?,?,?,?,?) ON CONFLICT(plan_id) DO UPDATE SET enabled=excluded.enabled,channel_ids=excluded.channel_ids,events=excluded.events,source_floor=excluded.source_floor'
				)
				.run(planId, +value.enabled, ids, events, changed ? this.floor() : saved.source_floor);
			return value;
		})();
	}
	private pendingCount() {
		return (
			this.sqlite
				.prepare(
					"SELECT COUNT(*) AS value FROM notification_deliveries WHERE status IN ('pending','sending')"
				)
				.get() as Row
		).value as number;
	}
	private insertEvent(payload: NotificationPayload, logicalKey: string, channels: Channel[]) {
		const now = this.clock();
		this.sqlite
			.prepare(
				'INSERT OR IGNORE INTO notification_events(id,logical_key,event_type,plan_id,plan_name,payload,created_at) VALUES (?,?,?,?,?,?,?)'
			)
			.run(
				payload.event_id,
				logicalKey,
				payload.event_type,
				payload.plan?.id || null,
				payload.plan?.name || null,
				JSON.stringify(payload),
				now
			);
		const event = this.sqlite
			.prepare('SELECT id FROM notification_events WHERE logical_key=?')
			.get(logicalKey) as Row;
		for (const channel of channels)
			this.sqlite
				.prepare(
					'INSERT OR IGNORE INTO notification_deliveries(id,event_id,channel_id,channel_name,kind,revision,created_at,next_attempt_at) VALUES (?,?,?,?,?,?,?,?)'
				)
				.run(
					id('nd'),
					event.id,
					channel.id,
					channel.name,
					channel.kind,
					channel.revision,
					now,
					now
				);
	}
	/** Persisted terminal projection, independent of all callbacks and agent networking. */
	reconcile(limit = 50): number {
		return this.sqlite.transaction(() => {
			const rows = this.sqlite
				.prepare(
					`
			 SELECT s.id AS source_id,s.kind,s.job_id FROM notification_sources s JOIN backups b ON s.kind='backup' AND s.job_id=b.id JOIN plans p ON p.id=b.plan_id
			 WHERE s.ready=1 AND b.status IN ('completed','failed','cancelled') AND COALESCE(b.in_progress,0)=0
			 UNION ALL
			 SELECT s.id AS source_id,s.kind,s.job_id FROM notification_sources s JOIN recovery_tests r ON s.kind='recovery' AND s.job_id=r.id JOIN plans p ON p.id=r.plan_id
			 WHERE s.ready=1 AND r.status IN ('passed','passed_with_warning','failed','cancelled')
			 AND COALESCE(CASE WHEN json_valid(r.result) THEN json_extract(r.result,'$.cleanup.infrastructure') END,1) <> 0
			 ORDER BY source_id LIMIT ?`
				)
				.all(limit) as Row[];
			let processed = 0;
			for (const projection of rows) {
				const kind = projection.kind as 'backup' | 'recovery';
				const row = this.sqlite
					.prepare(
						kind === 'backup'
							? 'SELECT b.*,p.title AS plan_name FROM backups b JOIN plans p ON p.id=b.plan_id WHERE b.id=?'
							: 'SELECT r.*,p.title AS plan_name FROM recovery_tests r JOIN plans p ON p.id=r.plan_id WHERE r.id=?'
					)
					.get(projection.job_id) as Row;
				if (
					this.sqlite
						.prepare('SELECT 1 FROM notification_observed WHERE source_id=? AND terminal_status=?')
						.get(projection.source_id, row.status)
				) {
					this.sqlite
						.prepare('UPDATE notification_sources SET ready=0 WHERE id=?')
						.run(projection.source_id);
					processed++;
					continue;
				}
				const payload = terminalPayload(kind, row, id('ne'), this.clock());
				const subscription = this.sqlite
					.prepare(
						'SELECT * FROM notification_subscriptions WHERE plan_id=? AND enabled=1 AND source_floor<?'
					)
					.get(row.plan_id, projection.source_id) as Row | undefined;
				const channels =
					subscription && JSON.parse(subscription.events).includes(payload.event_type)
						? this.channels().filter(
								channel =>
									channel.enabled &&
									projection.source_id > channel.sourceFloor &&
									JSON.parse(subscription.channel_ids).includes(channel.id) &&
									channel.events.includes(payload.event_type as any)
							)
						: [];
				if (this.pendingCount() + channels.length > maxPending) break; // Backpressure: do not lose the unseen event.
				if (channels.length) this.insertEvent(payload, `${kind}:${row.id}:${row.status}`, channels);
				this.sqlite
					.prepare(
						'INSERT OR IGNORE INTO notification_observed(source_id,terminal_status) VALUES (?,?)'
					)
					.run(projection.source_id, row.status);
				this.sqlite
					.prepare('UPDATE notification_sources SET ready=0 WHERE id=?')
					.run(projection.source_id);
				processed++;
			}
			return processed;
		})();
	}
	test(channelId: string): Delivery {
		return this.sqlite.transaction(() => {
			const channel = this.channel(channelId);
			if (!channel || channel.deleted) throw new AppError(404, 'Notification channel not found.');
			if (!channel.enabled) throw new AppError(409, 'Enable the channel before sending a test.');
			if (this.pendingCount() >= maxPending)
				throw new AppError(409, 'Notification queue is full. Retry later.');
			const payload: NotificationPayload = {
				version: 1,
				event_id: id('ne'),
				event_type: 'notification.test',
				timestamp: new Date(this.clock()).toISOString(),
			};
			this.insertEvent(payload, payload.event_id, [channel]);
			return this.deliveries(1, 0, payload.event_id)[0];
		})();
	}
	private deliveryView(row: Row): Delivery {
		const channel = this.channel(row.channel_id);
		return {
			id: row.id,
			eventId: row.event_id,
			eventType: row.event_type,
			planId: row.plan_id,
			planName: row.plan_name,
			channelId: row.channel_id,
			channelName: row.channel_name,
			kind: row.kind,
			revision: row.revision,
			status: row.status,
			attemptCount: row.attempt_count,
			cycleAttempts: row.cycle_attempts,
			manualRetries: row.manual_retries,
			createdAt: row.created_at,
			lastAttemptAt: row.last_attempt_at,
			nextAttemptAt: row.next_attempt_at,
			completedAt: row.completed_at,
			leaseUntil: row.lease_until,
			leaseOwner: row.lease_owner,
			errorCode: row.error_code,
			httpStatus: row.http_status,
			error: deliveryMessages[row.error_code as keyof typeof deliveryMessages],
			canRetry:
				row.status === 'failed' &&
				row.manual_retries < 3 &&
				row.attempt_count < 20 &&
				!!channel?.enabled &&
				!channel.deleted &&
				!this.deliveryPolicyError({
					planId: row.plan_id,
					channelId: row.channel_id,
					eventType: row.event_type,
				}),
		};
	}
	deliveries(limit = 50, offset = 0, eventId?: string): Delivery[] {
		const query =
			'SELECT d.*,e.event_type,e.plan_id,e.plan_name FROM notification_deliveries d JOIN notification_events e ON e.id=d.event_id';
		const rows = eventId
			? this.sqlite
					.prepare(query + ' WHERE e.id=? ORDER BY d.created_at DESC,d.id LIMIT ? OFFSET ?')
					.all(eventId, limit, offset)
			: this.sqlite
					.prepare(query + ' ORDER BY d.created_at DESC,d.id LIMIT ? OFFSET ?')
					.all(limit, offset);
		return (rows as Row[]).map(row => this.deliveryView(row));
	}
	delivery(deliveryId: string): Delivery | undefined {
		const row = this.sqlite
			.prepare(
				'SELECT d.*,e.event_type,e.plan_id,e.plan_name FROM notification_deliveries d JOIN notification_events e ON e.id=d.event_id WHERE d.id=?'
			)
			.get(deliveryId) as Row | undefined;
		return row && this.deliveryView(row);
	}
	claim(owner: string): Delivery | undefined {
		return this.sqlite.transaction(() => {
			const now = this.clock();
			this.sqlite
				.prepare(
					"UPDATE notification_deliveries SET status=CASE WHEN cycle_attempts>=5 OR attempt_count>=20 THEN 'failed' ELSE 'pending' END,error_code='delivery-interrupted',next_attempt_at=CASE WHEN cycle_attempts>=5 OR attempt_count>=20 THEN NULL ELSE ? END,completed_at=CASE WHEN cycle_attempts>=5 OR attempt_count>=20 THEN ? ELSE NULL END,lease_owner=NULL,lease_until=NULL WHERE status='sending' AND lease_until<=?"
				)
				.run(now + 30000, now, now);
			if (
				(
					this.sqlite
						.prepare("SELECT COUNT(*) AS value FROM notification_deliveries WHERE status='sending'")
						.get() as Row
				).value >= 2
			)
				return undefined;
			const row = this.sqlite
				.prepare(
					"SELECT id FROM notification_deliveries WHERE status='pending' AND next_attempt_at<=? AND cycle_attempts<5 AND attempt_count<20 ORDER BY next_attempt_at,created_at LIMIT 1"
				)
				.get(now) as Row | undefined;
			if (!row) return undefined;
			this.sqlite
				.prepare(
					"UPDATE notification_deliveries SET status='sending',attempt_count=attempt_count+1,cycle_attempts=cycle_attempts+1,last_attempt_at=?,lease_owner=?,lease_until=? WHERE id=? AND status='pending'"
				)
				.run(now, owner, now + 60000, row.id);
			return this.delivery(row.id);
		})();
	}
	payload(eventId: string): NotificationPayload {
		return JSON.parse(
			(
				this.sqlite
					.prepare('SELECT payload FROM notification_events WHERE id=?')
					.get(eventId) as Row
			).payload
		);
	}
	finish(delivery: Delivery, result: DeliveryResult): void {
		const now = this.clock();
		const retry =
			!result.success &&
			result.retryable &&
			delivery.cycleAttempts < 5 &&
			delivery.attemptCount < 20;
		const delay = Math.min(
			3600000,
			Math.max(30000 * 2 ** (delivery.cycleAttempts - 1), (result.retryAfterSeconds || 0) * 1000)
		);
		this.sqlite
			.prepare(
				"UPDATE notification_deliveries SET status=?,error_code=?,http_status=?,next_attempt_at=?,completed_at=?,lease_owner=NULL,lease_until=NULL WHERE id=? AND status='sending' AND lease_owner=?"
			)
			.run(
				result.success ? 'succeeded' : retry ? 'pending' : 'failed',
				result.success ? null : result.code || 'delivery-failed',
				result.status || null,
				retry ? now + delay : null,
				retry ? null : now,
				delivery.id,
				delivery.leaseOwner
			);
	}
	retry(deliveryId: string): Delivery {
		return this.sqlite.transaction(() => {
			const row = this.delivery(deliveryId);
			if (!row) throw new AppError(404, 'Notification delivery not found.');
			if (!row.canRetry)
				throw new AppError(
					409,
					'This delivery cannot be retried. Enable the channel, review its configuration and retry limits.'
				);
			if (this.pendingCount() >= maxPending)
				throw new AppError(409, 'Notification queue is full. Retry later.');
			this.sqlite
				.prepare(
					"UPDATE notification_deliveries SET status='pending',revision=?,cycle_attempts=0,manual_retries=manual_retries+1,next_attempt_at=?,completed_at=NULL,error_code=NULL,http_status=NULL WHERE id=? AND status='failed'"
				)
				.run(this.channel(row.channelId)!.revision, this.clock() + 30000, deliveryId);
			return this.delivery(deliveryId)!;
		})();
	}
	maintenance(): void {
		const cutoff = this.clock() - 30 * 86400000;
		this.sqlite
			.prepare(
				"DELETE FROM notification_deliveries WHERE id IN (SELECT id FROM notification_deliveries WHERE status IN ('succeeded','failed') ORDER BY created_at DESC LIMIT -1 OFFSET ?)"
			)
			.run(maxHistory);
		this.sqlite
			.prepare(
				"DELETE FROM notification_deliveries WHERE status IN ('succeeded','failed') AND created_at<?"
			)
			.run(cutoff);
		this.sqlite
			.prepare(
				'DELETE FROM notification_events WHERE NOT EXISTS(SELECT 1 FROM notification_deliveries d WHERE d.event_id=notification_events.id)'
			)
			.run();
		this.sqlite
			.prepare(
				'DELETE FROM notification_channels WHERE deleted=1 AND NOT EXISTS(SELECT 1 FROM notification_deliveries d WHERE d.channel_id=notification_channels.id)'
			)
			.run();
	}
}
