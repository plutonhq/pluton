# Webhook, JSON, dan HMAC

## Konfigurasi

Gunakan HTTPS receiver tanpa userinfo, query credential, atau fragment. Secret signing write-only disimpan terenkripsi; omitted berarti preserve, empty eksplisit berarti clear. Receiver wajib membatasi payload dan menyimpan event ID setelah signature valid.

## Payload dan signature

Payload JSON version 1 memuat `event_id`, `event_type`, timestamp event, plan binding, serta backup/recovery summary allowlisted. Transport headers: `X-Pluton-Payload-Version`, `X-Pluton-Event-Id`, `X-Pluton-Timestamp`, dan optional `X-Pluton-Signature`.

Signature adalah HMAC-SHA256 atas timestamp delivery, event ID, dan exact UTF-8 body dengan separator titik. Verifikasi raw bytes sebelum parse/normalisasi JSON; compare timing-safe dan bounded timestamp window. Secret contoh tidak dicantumkan.

```text
signed_bytes = delivery_timestamp + "." + event_id + "." + raw_json_body
header = "sha256=" + hex(HMAC_SHA256(secret, signed_bytes))
```

## Network guard

DNS setiap attempt divalidasi seluruh hasilnya lalu IP dipin; redirects tidak diikuti. Private LAN membutuhkan policy/CIDRs eksplisit. Loopback, link-local/metadata, unspecified, multicast, dan unsafe address families tetap ditolak. HTTP hanya trusted-LAN exception.

## Retry

Event/body tetap stable antar-attempt, timestamp signature baru. Dedupe receiver berdasarkan event ID, bukan timestamp transport. [Delivery History](/docs/notifications/history) menunjukkan outcome tanpa response body atau secret.
