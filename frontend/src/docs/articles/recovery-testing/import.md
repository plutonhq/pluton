# Import ke target recovery-only

## Prasyarat wajib

Operator menyediakan server database dedicated recovery-only, network isolation, restricted account, native client compatible pada Pluton Server, dan guard marker. Menyentang Dedicated dalam UI tidak menggantikan pemeriksaan DBA bahwa endpoint bukan production.

Guard bernama `pluton_recovery_guard` memuat purpose `pluton-phase6-recovery-only`; aplikasi memeriksa marker, grants, account attributes, dan visible catalog sebelum membuat disposable database. Provision marker/account melalui runbook DBA yang direview sesuai engine, bukan pada source database.

## Per-engine

MariaDB/MySQL memakai original logical DB name dari dump `--databases`; nama itu harus belum ada. App tidak drop existing DB agar import lolos. Account scope harus literal plan database names dan marker read-only, tanpa global admin/FILE/SUPER/grant option.

PostgreSQL membuat nama disposable `pluton_rt_...`, memakai psql restricted mode, owner-compatible account serta required NOLOGIN roles. Superuser/CREATEROLE/replication/BYPASSRLS/inherited broad roles ditolak. Genuine MySQL integration masih membutuhkan acceptance tersendiri.

## Cleanup ownership

Durable lease ditulis sebelum create; database baru mendapat ownership token. Cleanup hanya drop exact owned database yang marker-nya cocok. Crash di antara create/marker dapat memerlukan manual review; jangan drop unknown DB untuk membersihkan error.

## Required atau Disabled

Required tidak downgrade diam-diam. Disabled memeriksa artifact integrity tetapi SQL import NOT TESTED. Jangan menyalin source credential/endpoint supaya Required cepat Passed.
