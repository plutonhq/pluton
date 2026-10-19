# Batasan yang diketahui

## Implementasi versus acceptance

Automated tests/disposable native fixtures bukan production certification. Live webhook/SMTP acceptance ditunda sampai domain, receiver, relay, dan trusted certificates siap. S3 DRC/vendor-specific acceptance dan genuine MySQL native recovery integration belum dibuktikan oleh task ini.

## Agent dan storage

Linux Debian-family x86_64/systemd agent installer adalah jalur yang diuji. Windows/macOS/arm64 agent belum equivalent supported target. Outbound managed remote backup hanya SFTP allowlisted password-auth subset, bukan semua Rclone advanced options/providers.

## Recovery

Managed remote dan Legacy restore staging-only. Tidak ada restore-to-original, application failover/startup, production SQL auto-import, PITR, DB cluster role backup, atau guaranteed business-semantic recovery. Structural pass dan artifact hash tidak menggantikan SQL import/application test.

## Statistik

Restic summary tidak menyediakan deleted-file count atau total physical disk usage. Parent optimization memerlukan successful local receipt/metadata kompatibel; hilangnya receipt/state atau perubahan source/host/artifacts dapat menimbulkan baseline baru. Historical snapshots tidak di-rewrite.

## Operasional

Tidak ada multi-server shared-volume cluster mode/distributed scheduling yang ditambahkan. Tidak ada upstream commercial auto-updater, helper-dependent historical native installer, premium unlock, docs SaaS, atau fase baru. Production cutover/ACL/key rotation tetap manual authorized work.
