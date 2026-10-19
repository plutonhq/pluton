# MariaDB, MySQL, dan PostgreSQL

## Client pada agent

Client dump dipasang oleh administrator, bukan didownload installer. Executable dan canonical ancestors harus root-owned serta tidak group/other-writable. Capability inventory harus mengiklankan engine yang dipilih; Web UI tidak menerima arbitrary binary path.

MariaDB memakai genuine `mariadb-dump` atau alias `mysqldump` MariaDB yang diverifikasi. MySQL memerlukan genuine MySQL client; binary MariaDB yang bernama `mysqldump` bukan bukti support MySQL. PostgreSQL memakai `pg_dump` plain SQL dengan client-compatible server dan restriction envelope yang aman.

## Acceptance

MariaDB dan PostgreSQL mempunyai native disposable integration coverage. Genuine MySQL server/client integration masih acceptance gate tersendiri; synthetic tests tidak membuktikan semua MySQL versi. Perbedaan version, authentication plugin, extensions, owner, dan grants perlu uji pada target disposable.

## Pilihan DB

Satu entry memilih logical database, host/port, TLS, username, filename, timeout, dan max bytes. PostgreSQL tidak menerima MariaDB routines/events flags. Tidak ada cluster-wide dump, logical replication setup, PITR/WAL/binlog management, atau backup role/global configuration otomatis.

Periksa [transport](/docs/database-backup/connections), [privileges](/docs/database-backup/dump-options), dan target recovery-only sebelum Required import.
