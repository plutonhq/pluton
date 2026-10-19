# Status dan safe error codes

## Source dan repository

`source-parent-not-traversable`, `source-root-not-readable`, `source-entry-inaccessible`, `source-missing`, dan `source-symlink-escape` menunjukkan boundary berbeda. `repository-target-not-empty` adalah safety refusal. `target-not-found`/`target-empty` adalah checkpoint non-fatal; access/auth/transport target-check errors tetap fatal.

## Database dump

`database-auth-failed`, `database-insufficient-privileges`, `database-unavailable`, `database-tls-verification-failed`, `database-dump-timeout`, `database-client-missing`, `database-invalid-configuration`, dan `database-dump-failed` adalah closed classifications. Raw SQL/client stderr tidak muncul dalam error UI. Error numeric MariaDB/MySQL diterjemahkan sesuai kategori.

## Recovery

Queued/running/passed/passed_with_warning/failed/cancelled terpisah backup. `recovery-target-unsafe`, `database-role-missing`, artifact validation errors, dan cleanup warnings tidak diselesaikan dengan bypass target/ownership guard. Import Disabled/not configured ditampilkan NOT TESTED.

## Delivery

Pending/sending/delivered/failed adalah delivery status. Safe categories antara lain `destination-denied`, `connection-failed`, `tls-failed`, `delivery-timeout`, `smtp-retryable`, `smtp-rejected`, `channel-changed`, dan `delivery-failed`. Code tidak membawa remote body, credentials, atau stack trace.

## Penggunaan

Code/stage membantu memilih diagnostics, bukan API untuk automatic destructive remediation. Periksa actual layer serta logs sanitized sebelum retry atau perubahan infrastructure.
