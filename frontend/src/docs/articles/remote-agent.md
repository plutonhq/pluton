# Outbound-only Remote Agent

## Komunikasi

Agent membuka koneksi outbound ke Pluton Server untuk heartbeat, poll, ACK, progress, dan completion. Tidak diperlukan port agent inbound. Server memverifikasi identity, signed/HMAC command, lease, capabilities, dan plan binding. ONLINE ditentukan heartbeat timeout, bukan daemon yang bisa membaca semua file.

## Execution

Service `pluton-agent` berjalan non-root. Restic/Rclone/private Node dimiliki root, executable/readable oleh service account, tidak writable olehnya. Source dibatasi canonical allowed roots; repository, temp config, dan dump credentials memakai private state/workspace.

## Compatibility

Protocol filesystem version 1 dan lifecycle version 2/3 existing tetap dipakai. Agent v0.4.1 kompatibel dengan server; fix parent optimization memerlukan agent code dari revision hardening ini. Inventory version saja tidak membuktikan patch terpasang—catat source/build revision yang dipasang operator.

## Batas support

Installer Linux Debian/Ubuntu x86_64 dengan systemd adalah jalur yang diuji. Tidak ada Windows/macOS agent acceptance. Remote storage SFTP saja; arbitrary commands, raw shell, arbitrary client executable/config paths tidak diberikan via Web UI.

Mulai dari [enrollment](/docs/remote-agent/enrollment); periksa [source permissions](/docs/remote-agent/permissions) sebelum backup.
