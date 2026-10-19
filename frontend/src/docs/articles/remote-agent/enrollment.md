# Enrollment dan instalasi

## Token sekali pakai

Pada **Sources → Add Remote Machine**, buat enrollment token berumur terbatas. Jangan mempublikasikannya, menyimpannya di fixture, atau memasukkannya ke URL. Secure install meminta token interaktif; quick `--token` dapat masuk shell history/process listing dan tidak direkomendasikan untuk produksi.

## Installer

Checkout reviewed fork revision pada host agent. Contoh non-secret:

```sh
sudo bash installers/install-agent.sh \
  --server https://pluton.example.internal \
  --allowed-root /srv/example-app
```

Masukkan token pada prompt lokal. Untuk private CA, installer mendukung `--ca-file` dengan PEM trusted milik operator. Trusted-LAN HTTP memerlukan server allowance serta `--allow-insecure-http` agent; jangan memakai opsi HTTP pada URL HTTPS.

## Setelah instalasi

```sh
systemctl status pluton-agent
journalctl -u pluton-agent --since '10 minutes ago'
```

Periksa ONLINE, Restic/Rclone versions, BACKUP_FILESYSTEM capability, allowed roots, dan engines/hook readiness. Installer tidak memasang DB clients atau memperluas source ACL otomatis.

## Existing agent

Identity existing dipakai ulang. Jangan `--re-enroll` untuk sekadar menambah root atau mengganti server origin; explicit re-enrollment adalah operasi identity terpisah yang perlu otorisasi. [Update](/docs/remote-agent/updates) menjaga state ini.
