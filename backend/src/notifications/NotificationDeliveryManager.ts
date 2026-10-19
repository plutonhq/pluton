import { randomBytes } from 'node:crypto';
import { NotificationDeliveryStore } from '../stores/NotificationDeliveryStore';
import { deliverNotification } from './outboundDelivery';
import { serverLogger } from '../utils/logger';
import type { Delivery } from '../types/notificationDelivery';
export class NotificationDeliveryManager {
	private timer?: ReturnType<typeof setInterval>;
	private active = new Set<Promise<void>>();
	private stopped = true;
	constructor(
		private store: NotificationDeliveryStore,
		private deliver = deliverNotification
	) {}
	start() {
		if (!this.stopped) return;
		this.stopped = false;
		this.timer = setInterval(() => this.tick(), 5000);
		this.timer.unref();
		this.tick();
	}
	/** DB projection/claims only; transport promises never block a backup callback. */
	tick() {
		if (this.stopped) return;
		try {
			this.store.reconcile();
			this.store.maintenance();
			while (this.active.size < 2) {
				const row = this.store.claim(randomBytes(16).toString('hex'));
				if (!row) break;
				const promise = this.send(row).finally(() => this.active.delete(promise));
				this.active.add(promise);
			}
		} catch {
			serverLogger?.warn(
				{ event: 'notification_worker_failed' },
				'Notification worker state could not be processed; backup and recovery state are unchanged.'
			);
		}
	}
	private async send(row: Delivery) {
		try {
			const channel = this.store.channel(row.channelId);
			if (!channel || !channel.enabled || channel.deleted)
				return this.store.finish(row, { success: false, code: 'channel-disabled' });
			if (channel.revision !== row.revision)
				return this.store.finish(row, { success: false, code: 'channel-changed' });
			const policyError = this.store.deliveryPolicyError(row);
			if (policyError) return this.store.finish(row, { success: false, code: policyError });
			let secret: string | undefined;
			try {
				secret = this.store.channelSecret(row.channelId);
			} catch {
				return this.store.finish(row, { success: false, code: 'credential-invalid' });
			}
			const result = await this.deliver(channel, this.store.payload(row.eventId), secret, {
				canSend: () => {
					const live = this.store.channel(row.channelId);
					return (
						!!live?.enabled &&
						!live.deleted &&
						live.revision === row.revision &&
						!this.store.deliveryPolicyError(row)
					);
				},
			});
			this.store.finish(row, result);
		} catch {
			// No raw exceptions, provider diagnostics, credentials or payload in logs.
			try {
				this.store.finish(row, { success: false, code: 'delivery-failed' });
			} catch {
				/* Lease recovery handles a failed DB write. */
			}
			serverLogger?.warn(
				{ event: 'notification_delivery_failed' },
				'Notification delivery failed; inspect its sanitized history.'
			);
		}
	}
	async shutdown() {
		this.stopped = true;
		if (this.timer) clearInterval(this.timer);
		await Promise.allSettled([...this.active]);
	}
}
