# Mengenal Pluton mandiri

Pluton mengelola backup berbasis Restic dan storage Rclone melalui Web UI. Fork ini dipelihara independen dari upstream; nama dan lisensi open-source tetap dipertahankan. Tidak ada aktivasi berbayar, layanan docs terpisah, atau cloud account wajib.

## Kemampuan utama

Backup Plan menghubungkan source, destination, schedule, dan riwayat snapshot. Remote Agent mengambil pekerjaan melalui koneksi outbound. Database Lifecycle menambahkan 0–8 dump MariaDB/MySQL/PostgreSQL dan optional Pre/Post Hooks dalam satu snapshot. Browse, TAR Download, staged Restore, serta Recovery Test menggunakan exact snapshot. Webhook dan SMTP mempunyai durable outbox, subscriptions, retry, dan Delivery History.

## Batas dukungan

Managed remote backup saat ini menggunakan SFTP dengan subset konfigurasi yang ketat. Legacy Repository Adapter terpisah dan read-only. Recovery Test membuktikan aspek yang benar-benar diuji; Backup Complete tidak otomatis membuktikan aplikasi dapat beroperasi setelah disaster.

Pilot terbatas dan integration fixture bukan sertifikasi production. Live acceptance notifikasi masih memerlukan domain, receiver, relay, dan certificate milik operator. Lihat [batasan](/docs/reference/limitations).

## Mulai dengan aman

Ikuti [Quick Start](/docs/getting-started/quick-start) pada workload sintetis terlebih dahulu. Jangan menonaktifkan job backup lama sebelum [cutover](/docs/operations/cutover) disetujui. Panduan ini tidak meminta pengiriman credential, dump, atau inventory production.
