# Privilege, Events, timeout, dan limit

## Login bukan full dump acceptance

MariaDB/MySQL error 1045 menunjukkan authentication failure. Error 1044, 1142, dan 1227 adalah insufficient privileges, termasuk dump dengan `--events` yang memerlukan privilege tambahan walau SELECT/login berhasil. Jangan mengganti password karena semua error disebut auth.

Grant hanya privilege yang diperlukan bagi database/objects yang benar-benar dibackup. SELECT, SHOW VIEW, TRIGGER dan option-specific requirements harus direview DBA sesuai engine/version. Jangan memberi global SUPER/admin/FILE sebagai shortcut.

## Routines dan Events

Settings tidak dimatikan otomatis. Bila workload memang tidak mempunyai objects tersebut dan operator memutuskan tidak perlu mengarsipkannya, ubah opsi secara sadar; bila objects ada, grant yang sesuai dan test dump lengkap. “Tidak ikut dump” bukan “berhasil recover object”.

## Batas resource

DB timeout menerima 1–3600 detik; max dump bytes 1 KiB–100 GiB. Hook timeout terpisah 1–300 detik. Limit adalah guard resource, bukan jaminan disk/DB load aman. Partial non-empty SQL ketika client exit gagal tetap failure dan tidak masuk successful snapshot.

## Consistency

Review transactional engine, DDL, events, dan aplikasi writers. Satu Restic snapshot tidak membuat dump sequential dan filesystem atomic across all databases. [Hooks](/docs/database-backup/hooks) dapat membantu operational quiescing tetapi bukan distributed transaction.
