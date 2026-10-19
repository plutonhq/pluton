# Notifikasi dan durable outbox

## Interface

**Settings → Webhooks & Email** menyediakan named Webhook/SMTP channels, global event selection, test actions, dan Delivery History. Per-plan subscription ada pada **Advanced → Notification** dan disimpan terpisah dari plan form.

## Event

Backup completed/completed_with_warning/failed/cancelled dan recovery passed/passed_with_warning/failed/cancelled berasal dari persisted terminal outcome. Event berkaitan exact backup/test/snapshot; sanitized summary tidak memuat raw SQL, source inventory, credential, atau process output.

## Delivery

Worker outbox independen dari backup execution. Network/relay failure tidak membuat snapshot gagal. Stable event ID dan SMTP Message-ID membantu receiver deduplication, tetapi semantics external delivery tetap at-least-once, bukan exactly-once.

## Activation

Enable channel/subscription berlaku pada job baru setelah activation. Existing historical/already-running jobs tidak replay semua notifikasi. Manual recovery baru untuk old backup tetap job baru yang eligible sesuai subscriptions.

## Acceptance

Automated disposable receiver/TLS tests tersedia; live acceptance memerlukan operator-provided domain, certificate, receiver, dan SMTP relay. Jangan menampilkan pending infrastructure sebagai production-ready.

Legacy community SMTP/Slack/Discord/Ntfy integrations tetap compatibility path terpisah; hindari mengaktifkan dua jalur untuk event/recipient sama bila tidak ingin duplicate alerts.
