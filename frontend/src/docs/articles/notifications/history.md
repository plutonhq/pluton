# Delivery History dan retry

## Status

Pending menunggu worker; sending memegang lease; delivered berarti destination menerima sesuai protocol; failed memuat safe code dan bounded attempts. Status delivery tidak mengubah Backup Complete atau Recovery Test outcome.

## Batas retry

Ada lima automatic attempts per cycle dengan bounded exponential backoff, dan Retry-After valid dibatasi. Max dua sends concurrent, lease 60 detik. Expired lease tidak dijadikan success. Manual retry dibatasi tiga cycles, minimum delay 30 detik, total 20 attempts seumur delivery.

Webhook 408/429/500/502/503/504 dapat retry; kebanyakan 4xx dan unsupported statuses permanent. SMTP transient errors dapat retry; auth, recipient, dan certificate failure perlu tindakan operator sesuai code.

## History

UI paging 50 rows, error stage/code tanpa raw body/credential. Terminal history dibatasi 30 hari/20.000 records; active queue juga bounded. Worker/durable observed state menjaga logical-event dedup saat replay callbacks/restart.

## Tindakan aman

Perbaiki endpoint/CA/subscription dahulu, lalu Retry eligible setelah review channel. Jangan edit lease token/outbox SQLite atau re-run backup hanya untuk mengulang email. External at-least-once memungkinkan duplicate pada response loss: receiver event_id dedup wajib untuk tindakan downstream yang tidak idempotent.
