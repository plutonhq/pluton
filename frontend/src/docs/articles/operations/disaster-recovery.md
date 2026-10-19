# Disaster recovery runbook

## Persiapan offline

Simpan reviewed image digest, source revision, private keys/config backup, consistent SQLite backup, repository credentials, network/CA runbook, dan responsibility contacts di storage terkontrol off-host. Jangan menyimpan salinan plaintext pada repo publik.

## Control plane

Provision instance terisolasi dengan volume baru yang sengaja untuk restore test. Pulihkan pasangan DB/config/keys konsisten dengan code/migration journal. Jangan menjalankan service restored yang mempunyai jadwal aktif ke production destination sebelum routing/dispatch ditinjau; backup automation dapat memutasi managed repository.

## Data aplikasi

Pilih exact snapshot, restore staging, validasi filesystem/SQL hashes, dan import ke DB dedicated test bila diperlukan. Check application configuration, owners/grants, and business behavior secara manual. Recovery Passed structural bukan complete application failover.

## Cutover dan rollback

Gunakan approval, isolation, maintenance window, data freshness validation, dan rollback plan. Copy staging ke deployment baru, startup services, serta DNS switching bukan kemampuan auto-restore Pluton ini.

## Sesudah drill

Rekam actual RPO/RTO dan coverage yang diuji, cleanup private test workspaces/owned DB, dan review shortcomings. Jangan menyebut production certified dari unit tests atau menghapus snapshot lama untuk menyembunyikan failed drill.
