# Quick Start

## Persiapan

Gunakan VM dan source sintetis `/srv/example-app`, storage test, serta persistent volume baru. Untuk instalasi existing, jangan membuat key atau volume pengganti. Review [konfigurasi deployment](/docs/deployment/configuration) sebelum menjalankan script.

```sh
git clone https://github.com/ffigoperdana/pluton.git pluton
cd pluton
docker build -f Dockerfile.source -t pluton:reviewed .
```

Image lokal di atas adalah build test, bukan release semantik. Deployment produksi menggunakan image fork yang ditinjau dan immutable digest. Jangan memilih `latest` atau `main` sebagai target production.

## Setup aplikasi

Atur username/password administrator melalui konfigurasi Docker privat. Buka instance yang baru; desktop setup bukan prosedur bootstrap container. Tambahkan SFTP pada **Storages**, lalu gunakan **Sources → Add Remote Machine** untuk enrollment agent.

## Validasi pertama

Buat **Backup Plan** filesystem-only dengan Source dan Destination sintetis. Jalankan **Backup Now**; pastikan status Complete dan snapshot ID valid. Ulangi tanpa mengubah file, kemudian ubah satu file dan ulangi. Periksa [statistik incremental](/docs/backup-plans/incremental), Browse, TAR Download, dan staged Restore.

Setelah filesystem tervalidasi, aktifkan database, Recovery Test, dan subscriptions satu per satu. Keberhasilan login DB atau validasi Storage saja belum membuktikan backup/recovery lengkap.
