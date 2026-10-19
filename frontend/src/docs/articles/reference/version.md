# Identifikasi versi dan build

## Metadata lokal

Backend memakai `APP_VERSION` dari build/runtime dan optional valid hexadecimal `VCS_REF`. Header `X-App-Version`/`X-App-Revision` diambil frontend dari request auth yang memang diperlukan. Footer tidak menghubungi upstream untuk render.

Tagged semantic version ditampilkan apa adanya dengan prefix v. `main`, `pr-...`, atau unavailable metadata ditampilkan sebagai Development build, optional revision pendek. Tidak dibuat semantic release dari branch name.

## Image identity

OCI source/revision/version labels menjelaskan input pipeline; immutable digest adalah target deploy yang direview. Package version atau build label sendiri tidak membuktikan release telah dipublished di GitHub atau live acceptance selesai.

## Agent

Inventory agent v0.4.1 kompatibel existing protocol. Patch execution dari hardening ini memerlukan installed source/build revision yang baru; server/docs redeploy tidak otomatis memperbarui agent. Catat revision installer/repository checkout, bukan hanya angka inventory.

## Updates

Tidak ada trusted fork release feed yang configured, sehingga external upstream check/banner dihentikan. Tidak ada automatic pull latest, license activation, atau unsigned script updater. Gunakan [pembaruan manual](/docs/deployment/updates) dan [Changelog lokal](/docs/changelog) berdasarkan source history terverifikasi.
