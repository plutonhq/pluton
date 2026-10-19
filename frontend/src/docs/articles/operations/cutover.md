# Checklist cutover dari SYS MON

## Gate sebelum cutover

Backup lama tetap aktif selama shadow pilot. Repository Legacy tetap read-only. Managed repository baru harus mempunyai successful scheduled cycles, exact snapshots, credible counters, and available credentials/config backup.

- Validasi filesystem source + seluruh configured DB artifacts dalam snapshot.
- Browse/TAR Download/staged Restore berhasil pada exact snapshot.
- Required database import diuji pada dedicated recovery-only target bila semantic DB recovery diperlukan.
- Periksa warnings, cleanup, capacity, RPO/RTO, engine/client compatibility.
- Domain/CA/agent connectivity dan live webhook/SMTP acceptance selesai bila digunakan operasional.
- Persiapkan rollback service/image/keys/volume dan retained access repository lama.

## Approval

Owner aplikasi, DBA, infrastructure, dan security menyetujui procedure/window. Task coding tidak memberi otorisasi stop cron, edit production scripts, rotate master keys, overwrite source, atau drop production databases.

## Credential dan retention

Inventaris hardcoded old script credential privately; rotasi manual setelah consumers migrasi. Tentukan retention repository lama dengan pemilik data; Legacy Adapter tidak menjalankan forget/prune/unlock/migrate/repair.

## Sesudah cutover

Pantau beberapa cycles dan lakukan ulang restore drill. Snapshot backup yang berhasil tidak otomatis membuktikan application semantic recovery. Jika acceptance belum lengkap, jangan mematikan jalur SYS MON hanya demi menyederhanakan dashboard.
