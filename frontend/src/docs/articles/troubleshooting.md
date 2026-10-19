# Diagnostik yang aman

## Mulai dari stage

Catat status, exact backup/test ID, safe failure stage/code, waktu, dan apakah failure sebelum command leased atau saat agent execution. Jangan menebak penyebab dari error UI yang sengaja sanitized.

## Pemeriksaan minimum

UI Backup History/progress, server app log, journal agent, connection health, capabilities, source preflight, serta repository binding adalah evidence. SFTP login, DB login, atau Storage creation success menguji tahap berbeda dari backup/init/dump.

## Sharing

Gunakan synthetic app-01, domain example.internal, dan path `/srv/example-app` pada laporan publik. Jangan kirim enrollment token, HMAC, lease token, SSH password, repository password, master keys, SQL dump, plaintext config, atau seluruh SQLite dump.

## Larangan umum

Jangan regenerate secrets, recreate storage/plan, chmod 777, run agent root, disable TLS/allowed-root guard, init non-empty target, atau maintenance repository Legacy hanya agar error hilang. Investigasi actual stage dahulu.

Case studies berikut menggunakan synthetic infrastructure: [source](/docs/troubleshooting/source), [database](/docs/troubleshooting/database), [incremental/progress](/docs/troubleshooting/incremental), [SFTP](/docs/troubleshooting/sftp), [recovery](/docs/troubleshooting/recovery), dan [notifications](/docs/troubleshooting/notifications).
