# Migrasi parallel tanpa mutasi

## Shadow operation

Biarkan backup SYS MON lama tetap aktif selama pilot fork. Daftarkan repository lama read-only untuk inspection/recovery history. Buat managed repository baru dengan plan/source yang direview, bukan mengambil alih legacy destination untuk init/retention.

## Evidence

Catat successful backup baru, exact snapshot, filesystem counts, DB artifact sizes/hashes, staged restore, dan Recovery Test coverage. Validasi DB import pada dedicated target sebelum mengklaim semantic DB recovery. Compare RPO/RTO dan retention kebutuhan secara operasional, bukan hanya UI warna hijau.

## Credential lama

Hardcoded backup script credential lama harus diinventarisasi privately dan dirotasi manual setelah dependency/cutover disetujui. Jangan edit script/server production melalui task coding atau memasukkan credential dalam changelog.

## Cutover

Butuh approval eksplisit, recovery drill, rollback path, monitoring, dan maintenance window. Pilot success tidak mengotorisasi stop cron lama, drop DB, forget/prune legacy snapshots, atau replacement source path.

## Sesudah transisi

Pertahankan akses historical read-only sesuai kebijakan retention yang disetujui pemilik data. Tidak ada auto-rekey, metadata rewrite, atau migrate repository format. Gunakan [cutover checklist](/docs/operations/cutover) dan simpan operational evidence privat.
