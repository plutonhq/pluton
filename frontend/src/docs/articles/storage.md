# Memilih storage

## Model storage

**Storages** menyimpan konfigurasi Rclone provider, connection settings, dan credential terenkripsi. Berhasil membuat atau memvalidasi Storage membuktikan tahap koneksi tertentu, bukan seluruh repository lifecycle/retention/recovery.

Local managed lifecycle mempunyai beberapa Rclone providers. Managed outbound Remote Agent saat ini hanya mendukung SFTP password-auth subset yang di-allowlist. Jangan mengasumsikan provider yang tersedia di dropdown dapat dipakai remote plan.

## Repository baru

Managed plan memakai destination path tersendiri. Target yang belum ada atau ada tetapi kosong boleh diinisialisasi. Target berisi file/directory ditolak fail-closed. Authentication, access, transport, dan malformed config errors bukan bukti target kosong.

Existing Restic repository tidak diadopsi sebagai managed destination hanya untuk memakai UI. Daftarkan melalui [Legacy Adapter](/docs/legacy-repositories) read-only. Jangan mengarahkan init ke repository lama.

## Pemilihan praktis

Gunakan [SFTP mapping](/docs/storage/sftp) untuk remote pilot. [S3/local](/docs/storage/s3) memiliki operating-mode dan acceptance berbeda. Pastikan kapasitas, ACL, encryption password, dan repository isolation dipahami sebelum membuat plan.

Storage credentials dan repository password berbeda; jangan mengganti salah satunya saat error decryption tanpa investigasi key/config.
