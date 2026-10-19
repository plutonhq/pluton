# Workflow operator harian

## Review backup

Periksa latest scheduled job setiap plan, age/RPO, terminal status, snapshot ID, lifecycle warning, dan counter nyata. Unchanged filesystem boleh mempunyai Data Added kecil; semua New Files perlu diperiksa parent/canonical metadata, bukan langsung dianggap deduplication rusak.

## Review dependency

Pantau agent heartbeat/capabilities, storage capacity/permission, DB client/privileges, TLS certificates, server volume, serta disk staging/recovery. ONLINE atau healthy API tidak membuktikan full workload recoverability.

## Review recovery

Pastikan hasil terikat exact latest snapshot yang relevan. Passed with warning karena import Disabled masih SQL NOT TESTED. Lakukan staged restore drill dan semantic application validation terpisah pada target test sebelum RTO diterima.

## Review delivery

Delivery History adalah queue/history terpisah. Periksa failed code, attempts, channel revision, subscriptions, dan receiver-side dedup. Tidak perlu re-run backup hanya untuk mengirim ulang notifikasi.

## Perubahan

Pakai maintenance window, backup consistent control plane, immutable image, keys/volume preserved, dan rollback plan. Jangan disable SYS MON lama hanya karena beberapa pilot sukses. [Monitoring](/docs/operations/monitoring), [DR runbook](/docs/operations/disaster-recovery), dan [cutover](/docs/operations/cutover) melengkapi checklist ini.
