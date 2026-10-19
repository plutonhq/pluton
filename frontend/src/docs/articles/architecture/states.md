# Status, kegagalan, dan retry

## Backup

Job dapat queued/initializing, started, retrying, completed, failed, atau cancelled sesuai layer UI/API. Durable remote command mempunyai lease, ACK, progress sequence, dan completion. Progress event terlambat tidak boleh menimpa terminal status; heartbeat disconnect bukan alasan menghentikan proses backup lokal yang masih valid.

Retry memakai stable backup job binding. Successful local receipt dapat dikirim ulang tanpa dump/hook/Restic backup kedua. Jika receipt lokal hilang, tagged snapshot diperiksa agar job yang sama tidak membuat snapshot duplikat. Parent optimization hanya memakai successful receipt dan metadata kompatibel, bukan arbitrary newest snapshot.

## Recovery

Recovery mempunyai queued/running/passed/passed_with_warning/failed/cancelled sendiri. Backup Complete tetap Complete ketika recovery gagal. Cleanup status ikut hasil recovery; startup tidak melanjutkan SQL import yang terputus secara buta.

## Notification

Delivery pending/sending/delivered/failed terpisah dari backup/recovery. Retry bukan re-run backup. At-least-once memungkinkan response-loss duplicate, sehingga receiver perlu stable event ID deduplication.

## Tindakan operator

Periksa stage/code dan exact IDs sebelum retry. Jangan menghapus lease/queue/identity di SQLite untuk membuat UI terlihat bersih. Fix privilege, permission, TLS, atau storage cause lalu jalankan retry yang didukung. Lihat [safe codes](/docs/reference/status-codes).
