# Persyaratan sistem

## Pluton Server

Jalur deployment yang diverifikasi di repository adalah Docker source-built image, Linux amd64. Build menggunakan Node.js 24 dan pnpm 10.20.0, SQLite, Restic 0.19.1, dan Rclone 1.75.1. Gunakan engine Docker dengan Compose plugin dan penyimpanan persistent untuk `/data`. Container berjalan non-root.

Tidak ada angka kapasitas universal: sediakan CPU, RAM, dan disk berdasarkan jumlah pekerjaan concurrent, ukuran staging/download, cache, dan Recovery Test. Restore serta recovery dapat membutuhkan ruang mendekati ukuran logical snapshot; ukuran repository terkompresi bukan estimasi workspace yang aman.

## Source agent

Installer agent mendukung Linux Debian/Ubuntu x86_64 dan systemd. Private Node/runtime tidak mengganti Node global host. Database client dipasang terpisah oleh administrator; agent hanya mengiklankan engine yang client-nya valid. Windows/macOS agent tidak mempunyai acceptance yang setara.

## Infrastruktur

Source harus terbaca service account non-root. SFTP memerlukan directory writable hanya pada tujuan managed repository. DNS, firewall outbound agent ke server, serta server ke storage/recovery/notification targets adalah tanggung jawab operator. HTTPS production membutuhkan certificate yang valid bagi setiap client, bukan hanya browser administrator.

Lanjutkan ke [deployment](/docs/deployment) dan [permission source](/docs/remote-agent/permissions).
