# OFFLINE, inventory, dan pencabutan

## OFFLINE

Periksa systemd status, DNS dan routing dari host agent, server origin, CA trust, firewall outbound, serta waktu host. HTTPS yang valid di browser belum tentu trusted oleh private Node agent. Gunakan private CA file yang didukung, bukan disable certificate verification.

## Heartbeat-only check

```sh
sudo -u pluton-agent /opt/pluton-agent/runtime/bin/node \
  /opt/pluton-agent/app/dist/index.js check
```

Gunakan environment/config service yang sama; menjalankan CLI tanpa environment service tidak otomatis membaca seluruh systemd EnvironmentFile. `check` tidak poll atau menjalankan queued backup. Jangan gunakan `run --once` sebagai pengganti connection check pada agent yang mempunyai pekerjaan queued.

## Capabilities

Missing BACKUP_FILESYSTEM berarti roots/tools belum memenuhi validation. Missing engine berarti DB client belum dikenali/root-owned. Update inventory setelah client/permission ditinjau; jangan memalsukan capabilities di database.

## Revoke/remove

Pencabutan dari control plane memblokir agent/command sesuai state. Review active jobs dan plan association sebelum remove. Installer uninstall tanpa purge tidak sama dengan destructive state removal; `--purge` atau `--re-enroll` memerlukan keputusan eksplisit, bukan langkah default untuk OFFLINE.

Lihat [troubleshooting source](/docs/troubleshooting/source) untuk ONLINE tetapi backup source gagal.
