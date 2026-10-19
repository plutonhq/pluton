# Membuat Backup Plan

## Satu workload

Gunakan satu plan untuk satu aplikasi/workload. Pada **Sources** pilih remote machine yang ONLINE, lalu **Backup Plan** dengan filesystem source. Remote source saat ini satu absolute path, canonical setelah symlink resolution, dan harus berada dalam allowed roots agent. Exclusion tidak memperluas allowed-root policy.

## Destination

Pilih Storage SFTP dan destination relative repository path tersendiri, misalnya `daily/app-01`. Jangan memakai repository Legacy atau target yang sudah berisi data unrelated. Storage creation success tidak membuktikan Restic init akan diizinkan.

## Advanced

Atur schedule dan settings yang benar-benar didukung mode plan. **Advanced → Database & Hooks** menambahkan optional 0–8 DB; server membuat stable database ID. Notification subscription disimpan terpisah setelah plan tersimpan. Recovery policy juga tidak sama dengan backup success status.

## Pemeriksaan pertama

Jalankan filesystem-only Backup Now dahulu, lalu Browse, TAR Download, staged Restore, dan Recovery Test. Tambahkan DB/hooks satu per satu dan pastikan semua artifacts terikat ke exact snapshot.

Tidak perlu membuat ulang plan/storage setelah fix parent tracking. Existing snapshot paths/IDs dan credential tetap dipakai. Lihat [history](/docs/backup-plans/history) dan [incremental](/docs/backup-plans/incremental).
