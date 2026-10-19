# Kontrak repository read-only

## Pemisahan wajib

Legacy Repository Adapter mendaftarkan existing Restic repository untuk inspection/recovery, bukan adoption ke managed Backup Plan. Repository berada pada filesystem lokal yang dapat dibaca server, idealnya melalui read-only mount/storage credential scope.

Operation allowlist ditegakkan backend. Snapshot list/stats/browse membutuhkan supported read-only `--no-lock` contract. Tidak ada fallback write credentials atau automatic unlock bila contract gagal.

## Operasi terlarang

Adapter tidak menjalankan init, backup, re-key, tag, copy into repository, retention, forget, prune, unlock, migrate, atau repair. Jangan menggunakan forbidden commands sebagai error recovery. Read-only repository access tetap bisa menghasilkan file tujuan ketika staged Restore; destination writes dibatasi area owned staging.

## Compatibility

Repository lama, snapshot IDs, dan encrypted password binding dipertahankan. Belum ada matrix universal seluruh Restic versions/formats. Supported read-only behavior harus diverifikasi pada disposable copy/target sesuai mode, bukan mencoba mutasi repository source.

## Migrasi

Gunakan [parallel migration](/docs/legacy-repositories/migration) dan register secara [read-only](/docs/legacy-repositories/registration). Jangan memakai managed lifecycle hanya untuk mendapatkan tampilan snapshot lama atau retention controls.
