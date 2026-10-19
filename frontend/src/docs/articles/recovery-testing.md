# Backup Complete bukan Recovery Passed

## Tujuan

Recovery Test mencoba restore exact managed remote snapshot lalu memvalidasi filesystem dan recorded SQL artifacts. Statusnya terpisah dari Backup Complete: backup dapat sukses sementara recovery belum diuji atau gagal.

## Cara menjalankan

Gunakan **Run Recovery Test** pada completed backup row. Pada saved remote plan, **Advanced → Recovery Testing** menyimpan policy/engine targets terpisah dari plan form. Auto-run setelah successful backup opt-in, bukan replay semua snapshot historis atau periodic schedule baru.

## Binding

Test record memuat backup ID dan snapshot ID yang benar-benar diuji. Older Passed tidak mengesahkan latest backup yang berbeda. Manual test snapshot historis boleh dilakukan jika managed binding/source tree/metadata dapat dibuktikan; missing identity tidak diisi dengan tebakan.

## Tahap

Repository inspection, dedicated workspace restore, structural validation, artifact bytes/SHA-256, optional SQL import, lalu cleanup. Tidak ada source-agent contact, production import, legacy maintenance, atau restore-to-original.

## Acceptance

Filesystem dan native MariaDB/PostgreSQL fixture memberikan evidence terbatas. Test Passed tidak membuktikan seluruh semantic/business workflow aplikasi. Lihat [validation](/docs/recovery-testing/validation), [import](/docs/recovery-testing/import), dan [hasil](/docs/recovery-testing/results).
