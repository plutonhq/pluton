# Webhook, SMTP, dan konektivitas HTTPS

## Gejala

Delivery pending/retrying/failed, SMTP certificate errors, atau browser domain HTTPS berhasil tetapi agent tetap OFFLINE. Test channel queued belum berarti delivery sukses.

## Penyebab

DNS/CA trust berbeda antar host/runtime, certificate hostname mismatch, receiver timeout/auth/recipient rejection, unapproved private CIDRs, removed subscription, disabled channel, atau revision berubah. Backup lama tidak replay setelah activation adalah behavior normal.

## Diagnostik aman

Gunakan Delivery History safe code/status/attempts, server journal, receiver event ID, dan host-side DNS/TLS check. Jangan kirim HMAC/signing secret, relay password, raw receiver body, atau private key. Korelasikan exact event/snapshot, bukan nama plan saja.

## Resolusi

Betulkan certificate/hostname/trust chain, explicit endpoint policy, subscriptions, dan recipient/auth configuration. Retry eligible setelah channel review. Validasi DNS dari agent dan update origin via installer tanpa re-enroll untuk HTTPS migration.

## Jangan lakukan

Jangan disable rejectUnauthorized, downgrade ke HTTP/plain di public network, allow broad arbitrary endpoints, atau re-run backup hanya untuk email. Receiver dedupe wajib karena response-loss retry at-least-once. Live acceptance memerlukan infrastructure siap; automated SMTP fixture bukan inbox/production success.
