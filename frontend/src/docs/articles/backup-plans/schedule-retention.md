# Schedule, Retention, dan retry

## Schedule

Plan interval dikonversi menjadi cron dan direkonsiliasi dengan database pada startup. Pause/resume plan menghentikan/melanjutkan schedule, bukan menghapus snapshot. Waktu server dan timezone mempengaruhi operasi terjadwal; lakukan uji pada interval aman setelah deployment.

Active backup untuk plan yang sama mencegah enqueue concurrent yang tidak kompatibel. Remote queue persistent mempunyai agent lease; server restart dan source disconnect berbeda dari scheduled backup baru.

## Retention

Local managed lifecycle mempunyai retention/prune behavior sendiri. Jangan menganggap fitur tersebut otomatis aktif untuk outbound remote: remote validator membatasi settings yang belum didukung. UI/save error harus direview, bukan diatasi dengan mengubah SQLite secara manual.

Legacy Repository Adapter tidak mempunyai retention, forget, prune, unlock, repair, atau migrate path. Jangan menerapkan retention plan managed ke repository legacy.

## Retry dan replay

Retry internal memakai job/command binding yang sama; successful receipt/snapshot tag mencegah backup duplikat ketika completion ACK hilang. Manual Backup Now setelah job terminal adalah backup baru dengan ID baru. Parent tracking memakai prior successful receipt yang kompatibel, bukan snapshot failed yang kebetulan paling baru.

Periksa safe error stage sebelum retry. Jadwal berulang bukan solusi untuk credential/privilege/TLS failure. Jangan menonaktifkan backup lama sebelum [cutover](/docs/operations/cutover).
