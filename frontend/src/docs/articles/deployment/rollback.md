# Prosedur rollback

## Sebelum perubahan

Catat image reference/digest yang healthy, migration journal, agent source revision, volume name, dan backup control-plane konsisten. Jangan menyimpan keys dalam ticket atau public report. Pastikan tidak ada backup, restore, SQL import, atau delivery yang masih in-flight sebelum stop terencana.

## Rollback container

`deploy/rollback.sh` memakai state image sebelumnya dan mempertahankan `.env` serta volume. Operator harus memeriksa schema compatibility terlebih dahulu: image rollback tidak otomatis mengembalikan migration database. Task ini sendiri tidak menambah migration.

Setelah bundle host direview dan di-upgrade, rollback memakai digest immutable dan stack overlay lengkap yang sama, termasuk `compose.lab.yml`. Keberhasilan memerlukan Docker healthy, respons GET health valid, image benar, UID/GID, dan mount yang tidak berubah. Backup SQLite tidak pernah ditimpa otomatis; lease/ownership records tetap dipertahankan. Kegagalan deploy tetap exit nonzero meskipun automatic rollback berhasil.

```sh
cd /opt/pluton
sh rollback.sh
sh status.sh
```

Gunakan hanya pada deployment yang memakai script tersebut dan telah mempunyai `.deploy-state` valid. Jangan menebak tag/image lama atau mengganti volume dengan volume kosong.

## Rollback agent

Installer menjaga aplikasi/runtime sebelumnya jika validasi install gagal. Untuk rollback terencana, gunakan reviewed source/binary lama dengan config roots dan identity yang sama. Jangan menyalin state dari agent lain. Server tetap menerima agent v0.4.1; agent lama belum membawa fix parent selection ini.

## Verifikasi

Periksa heartbeat-only `check`, backup/history yang existing, decryption credential, dan exact snapshot access. Snapshot tidak ditulis ulang oleh rollback code. Delivery HTTP/SMTP adalah at-least-once: receiver tetap perlu deduplicate event ID bila terjadi response loss/restart.
