# Docker dan source-built image

## Build dari source

```sh
docker build -f Dockerfile.source -t pluton:reviewed .
```

Build memakai dependency lockfile dan menyalin frontend/docs ke backend public assets. Runtime menjalankan user `pluton`, bukan root, dengan Restic/Rclone pinned. Docker Compose menambahkan read-only root filesystem, tmpfs, dropped capabilities, dan persistent `/data`.

## Deployment release

Host membutuhkan Docker/Compose v2 dan Python 3.8+ stdlib, tanpa mengganti Node global. `deploy/install.sh` hanya menerima SHA-256 digest immutable; semua tag ditolak. Untuk instalasi existing, upgrade bundle host satu kali dari checkout yang direview memakai `deploy/upgrade-host.sh` dan approval hash. Pull image tidak memperbarui script host. Prosedur lengkap ada di file repository `docs/DEPLOYMENT_OVERLAY_AND_HEALTHCHECK_FIX.md`.

```sh
cd /opt/pluton
sh ./install.sh 'sha256:<verified-image-digest>'
sh ./status.sh
```

Placeholder sengaja tidak executable tanpa penggantian. Set `PLUTON_IMAGE` ke registry milik fork serta konfigurasi privat sebelum deployment. Script tidak membuat atau merotasi key. Direktori yang benar-benar baru hanya menerima salinan bundle/template lalu berhenti untuk konfigurasi offline; jangan memakai jalur new-install untuk data existing.

`compose.lab.yml` yang disetujui otomatis mengikuti base; overlay lain harus tercantum dalam `compose.overlays`. Deploy dan rollback memakai stack yang sama, hanya recreate `pluton`, dan memverifikasi semua mount/volume serta GET readiness. Tidak perlu Compose up tambahan. Dual-origin eksplisit tidak memerlukan `TRUST_PROXY=1`; localhost tidak perlu ditambahkan sebagai origin browser untuk healthcheck.

## Jangan lakukan

Jangan mount Docker socket, repository production, atau `/` host untuk smoke test. Jangan menghapus persistent volume untuk mengatasi startup failure. Pembaruan yang melibatkan migration fase sebelumnya membutuhkan backup DB dan keys konsisten; automatic health rollback bukan jaminan down-migration.

Setelah startup, lakukan [smoke validation](/docs/deployment/updates#validasi-setelah-startup).
