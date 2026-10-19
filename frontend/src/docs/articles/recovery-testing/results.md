# Passed, warning, Failed, dan cleanup

| Hasil               | Makna operasional                                                                   |
| ------------------- | ----------------------------------------------------------------------------------- |
| Passed              | Semua validasi yang diwajibkan untuk snapshot ini lolos                             |
| Passed with warning | Validasi inti lolos, tetapi import tidak diuji atau cleanup/operational warning ada |
| Failed              | Salah satu required check gagal; snapshot backup tidak otomatis hilang              |
| Cancelled           | Test dihentikan; jangan menganggap validasi lengkap                                 |

## Filesystem-only

Structural restore dapat Passed tanpa database. Catat exact snapshot ID, tested time, file/byte count, dan cleanup. Hasil bukan sertifikat aplikasi production.

## Database artifact-only

Bytes dan SHA-256 dapat passed, tetapi jika import Disabled, UI harus menyatakan **SQL import NOT TESTED**. Ini bukan semantic DB recoverability. Required import tanpa target/identity/client yang valid menghasilkan Failed, bukan warning ringan.

## Cleanup

Periksa workspace cleanup dan DB cleanup secara terpisah. Cleanup incomplete dapat meninggalkan sensitive SQL atau disposable DB; ownership guard tetap diperlukan untuk tindakan manual. Existing production DB tidak dibersihkan oleh Recovery Test.

## Snapshot binding

Lihat hasil yang terikat backup yang dipilih. Latest attempt dan latest backup berbeda; pass lama tidak menggantikan failed/not-tested untuk snapshot baru. Notifications menggunakan exact persisted test/snapshot binding dan tidak mengubah Backup Complete status.
