# Pembaruan dan identity preservation

## Configuration-only reinstall

Jalankan installer dari reviewed revision dengan semua allowed roots yang diinginkan. `--allowed-root` dapat diulang:

```sh
sudo bash installers/install-agent.sh \
  --server https://pluton.example.internal \
  --allowed-root /srv/example-app \
  --allowed-root /srv/example-logs
```

Ini tidak meminta enrollment baru bila identity healthy. Jangan menghilangkan root lama yang masih dibutuhkan plan. Installer menormalisasi runtime/app root-owned, directory traversable, binary executable, dan memvalidasi sebagai service account sebelum install diterima.

## Cache dan pinning

Private Node, Restic, dan Rclone dapat direuse hanya bila manifest SHA-256/version/mode/ownership sesuai pin installer. Cache tidak berarti memakai executable arbitrary dari PATH. Corrupt/writable binaries bukan candidate trusted. Tidak ada auto-upgrade Node global.

## Rollback

Transaction menyimpan aplikasi working sebelumnya; validasi gagal memulihkan instalasi lama. Existing identity dan allowed roots perlu tetap konsisten. Jangan menghapus `/var/lib/pluton-agent` untuk memperbaiki version/capability mismatch.

## Patch parent

Server-only deploy memperbaiki labels/docs, tetapi incremental optimization terjadi pada agent execution. Simpan source/build revision patch; inventory v0.4.1 tidak membedakan patch revision. Setelah update, jalankan dua backup disposable dan periksa parent/counters sebelum acceptance workload existing.
