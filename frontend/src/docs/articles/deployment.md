# Model deployment

## Jalur yang dipelihara

Source-built Docker image dari repository fork adalah jalur server yang dipelihara. Frontend, API, dan dokumentasi `/docs` berada dalam aplikasi yang sama. SQLite dan konfigurasi persistent disimpan di `/data`; repository backup boleh berada pada storage terpisah.

Repository juga menyimpan packaging historis desktop/native. Installer yang bergantung pada helper/CDN upstream dinonaktifkan sebelum download atau perubahan system. Jangan mengikuti contoh curl-to-shell upstream untuk menginstal fork ini. Tidak ada penggantian otomatis global Node atau update binary melalui layanan komersial.

## Pilihan image

`Dockerfile.source` membangun source dengan pnpm lockfile. `Dockerfile` adalah jalur release-asset yang memakai executable hasil pipeline; jangan mencampur input keduanya. OCI labels menyimpan source, version, dan revision. Tag mutable bukan bukti revision immutable.

## Persiapan perubahan

Catat image digest sebelumnya, nama persistent volume, lokasi private environment, key material, serta SQLite checkpoint/backup konsisten. Hentikan dispatch pekerjaan sebelum maintenance yang direncanakan. Jadwalkan rollback bersama schema compatibility; jangan langsung menjalankan code lama terhadap schema dari fase yang lebih baru.

Lihat [Docker](/docs/deployment/docker), [persistence](/docs/deployment/persistence), dan [rollback](/docs/deployment/rollback).
