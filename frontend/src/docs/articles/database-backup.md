# Filesystem dan database dalam satu snapshot

## Konfigurasi

**Edit Plan → Advanced → Database & Hooks → Enable database backup** mengaktifkan collection DB. Gunakan **Add Database**, remove, serta move up/down untuk urutan dump. Satu plan mendukung 0–8 entries, campuran MariaDB/MySQL/PostgreSQL dengan filenames unik.

Database ID `db_...` dibuat server dan tetap stable saat reorder/edit. Temporary card ID UI tidak disubmit sebagai persisted identity. Saved password direspons hanya sebagai `passwordConfigured`; blank/omitted edit mempertahankan ciphertext sesuai normalisasi API.

## Eksekusi

Dump dijalankan sequential. Semua entries harus sukses sebelum Restic backup filesystem+artifacts sekali. Kegagalan DB kedua menghentikan entry berikutnya dan backup; partial SQL file bukan success. Tidak ada parallel dumps yang diam-diam membebani server DB.

## Existing plan

Migrated single-DB plan tetap dibuka sebagai satu entry dengan credential binding yang sama. Jangan membuat ulang plan atau memasukkan password ulang hanya karena perubahan UI/docs. Multi-DB tidak didowngrade ke single-DB oleh request lama.

## Sesudah backup

Exact snapshot/artifact confirmation mencatat bytes/SHA-256 dan identities untuk recovery. SQL artifact dapat berubah setiap dump; parent fix tidak memalsukan file change counts. Baca [engines](/docs/database-backup/engines) dan [consistency](/docs/database-backup/artifacts).
