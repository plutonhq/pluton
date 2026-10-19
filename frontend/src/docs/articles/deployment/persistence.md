# Volume, SQLite, dan configuration backup

## Data yang wajib bertahan

`/data` menyimpan control database, config, keys, job history, cache, downloads, restore, dan recovery workspace. Repository Restic adalah data plane terpisah. Backup volume Pluton saja belum mencakup repository; backup repository saja tidak mencakup plan, subscriptions, dan encrypted credential metadata.

SQLite memakai WAL. Copy file `.db` saat penulisan masih berjalan tanpa WAL/consistency procedure bukan backup yang dapat dipercaya. Deployment script menghentikan service sebelum menyalin control DB. Pertahankan key material dan konfigurasi dari titik waktu yang kompatibel.

## Self-backup

Settings menyediakan self-backup control plane dan CLI self-restore. Pakai runbook yang ditinjau untuk installation mode terkait; restore control plane memerlukan key lama dan schema/code compatible. Jangan menganggap self-backup melakukan recovery aplikasi source atau rotasi credential.

## Perlindungan

Simpan copy terenkripsi off-host dengan akses terbatas, verifikasi restore pada instance disposable, dan catat image digest serta migration journal. Jangan mempublikasikan dump SQLite: ciphertext, identities, inventory, dan key references tetap sensitif walaupun bukan plaintext password.

## Saat gagal startup

Missing/conflicting/corrupt key adalah error fail-closed. Pulihkan pasangan config/key yang asli; jangan menghapus config agar generator membuat key baru. Lanjutkan ke [disaster recovery](/docs/operations/disaster-recovery).
