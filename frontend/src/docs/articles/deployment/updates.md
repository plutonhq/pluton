# Release dan pembaruan aman

## Sumber versi

Footer menampilkan metadata lokal `APP_VERSION` dan, bila tersedia, `VCS_REF` yang diberikan build pipeline. Build `main` bukan semantic release: UI menyebut Development build beserta revision, bukan `vmain`. Tanpa metadata, tidak dibuat nomor versi palsu.

Tidak ada trusted fork update feed yang dikonfigurasi. Pemeriksaan release upstream dan banner Update Available dinonaktifkan. Ini bukan auto-updater; notifikasi version mismatch PWA hanya menyegarkan asset instance yang sama, bukan mengunduh aplikasi upstream.

## Prosedur update

Review diff, tests, migration, dan release artifacts. Simpan key/SQLite backup konsisten, image digest lama, serta manifest volume. Gunakan deployment script dengan digest atau release tag yang ditinjau; jangan pull `latest` otomatis. Upgrade agent dari source revision yang sama bila fix agent diperlukan, tanpa `--re-enroll`.

## Validasi setelah startup

Periksa `/api/health`, login, footer revision, nested `/docs` refresh, Sources ONLINE, dan existing plans/storage. Jalankan backup sintetis dua kali, Browse/Restore/recovery exact snapshot, dan periksa lifecycle warning/outbox. Live SMTP/webhook acceptance dilakukan terpisah setelah infrastructure siap.

## Batas compatibility

Task product-hardening ini tidak menambah schema migration atau mengganti secrets. Rollback aplikasi harus tetap ke build yang mendukung Phase 7 schema; jangan rollback melewati multi-DB atau notification migrations tanpa restore control plane yang terkoordinasi.
