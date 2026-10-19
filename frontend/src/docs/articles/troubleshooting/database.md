# Login berhasil tetapi dump gagal

## Gejala

TCP login account `backup_reader` ke DB sintetis berhasil, tetapi dump `--events` gagal 1044. Temporary `.sql` dapat non-empty namun backup tidak mencapai Restic.

## Penyebab

Login/authentication dan object privileges berbeda. 1045 adalah auth; 1044/1142/1227 adalah insufficient privileges. Routines/Events, views/triggers, transactional consistency, connection/TLS, timeout, missing client, dan invalid config mempunyai error category berbeda.

## Diagnostik aman

Periksa safe databaseId/engine/stage/code pada journal/UI. DBA meninjau grants/object inventory secara privat dan menguji dump client yang sama, options yang sama, serta service account runtime. Jangan berbagi SQL/credential/raw config.

## Resolusi

Grant privilege minimum sesuai objek yang perlu dibackup. Jika workload benar-benar tidak mempunyai Events/Routines dan operator menyetujuinya, ubah flags eksplisit; jangan matikan otomatis. Perbaiki TLS/client/timeout sesuai kategori, bukan merotasi password untuk semua kegagalan.

## Jangan lakukan

Jangan menerima partial SQL sebagai success, grant global admin/SUPER/FILE, bypass client validation, atau mengimpor ke source DB untuk test. [Dump options](/docs/database-backup/dump-options) dan [Required import](/docs/recovery-testing/import) menjaga boundary ini.
