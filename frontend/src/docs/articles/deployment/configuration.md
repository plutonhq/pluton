# Docker Compose dan environment

## File privat

Gunakan `deploy/compose.yml` dan `.env.example` sebagai template, bukan menyalin credential ke Git. File `.env` VM harus privat. `PLUTON_IMAGE_REF` menunjuk image immutable; `PLUTON_VOLUME_NAME` menjaga nama volume yang sama saat upgrade. `PLUTON_PORT` mengatur publish port host, sedangkan `SERVER_PORT` container adalah 5173.

## Parameter penting

`ENCRYPTION_KEY`, `USER_NAME`, dan `USER_PASSWORD` wajib untuk konfigurasi container biasa. `APP_URL` harus origin yang dapat dijangkau pengguna; setelah reverse proxy aktif gunakan origin HTTPS tersebut. `MAX_CONCURRENT_BACKUPS` membatasi workload server, bukan izin menjalankan SQL parallel pada agent.

`SECRET` serta `APIKEY` disimpan sesuai CredentialManager; pertahankan file key existing di data/config. Jangan menyetel nilai baru saat key persistent sudah ada. `TRUST_PROXY` hanya untuk reverse proxy yang benar-benar dipercaya, bukan `true` pada jaringan tanpa pembatasan.

## Trusted-LAN pilot

Backend mengenali `ALLOW_INSECURE_AGENT_HTTP`; Compose template tidak meneruskan seluruh environment arbitrary. Jika pilot HTTP dibutuhkan, operator harus menambahkan variable ini secara eksplisit pada environment service dan memilih `--allow-insecure-http` di agent. Ini exception dua sisi, bukan TLS bypass universal.

Lihat [referensi konfigurasi](/docs/reference/configuration) dan [HTTPS](/docs/security/https). Tidak ada SMTP/webhook credential dalam environment contoh portal ini.
