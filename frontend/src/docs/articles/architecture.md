# Komponen arsitektur

## Control plane

React Web UI memanggil backend Express. SQLite menyimpan plans, backups, storages, remote commands, recovery tests, dan notification outbox. Secrets disimpan terenkripsi dengan key lokal yang dipertahankan. Dokumentasi adalah static bundle yang tidak membaca control plane.

## Data plane

Agent Linux melakukan poll outbound ke Pluton Server, memverifikasi signature/HMAC dan lease, lalu menjalankan Restic/Rclone privat sebagai service account non-root. Source canonical harus berada di allowed roots. SQL dump dan credential file dibuat dalam workspace job privat, bukan live source.

Restic menangani enkripsi, compression, content deduplication, snapshot, dan restore. Rclone menghubungkan repository ke storage. Repository bukan direktori staging atau SQLite database. Server melakukan managed remote Browse/Restore/Recovery memakai repository session exact snapshot tanpa menghubungi source agent.

## Perbedaan lifecycle

Local managed backup, outbound Remote Agent, dan Legacy Adapter mempunyai boundary berbeda. Legacy tidak diarahkan melalui scheduler/retention managed. Remote recovery staging tidak berarti local historical restore behavior otomatis berubah menjadi staging-only.

## Notifikasi

Terminal state menjadi source durable untuk worker outbox independen. Backup selesai tidak menunggu HTTP receiver atau SMTP relay. Receiver failure tidak mengubah snapshot menjadi gagal. Lihat [workflow](/docs/architecture/workflow) dan [status](/docs/architecture/states).
