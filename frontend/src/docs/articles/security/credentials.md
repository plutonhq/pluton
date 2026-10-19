# SECRET, ENCRYPTION_KEY, dan rotasi

## Preservasi

`SECRET` mengenkripsi stored application credentials. `ENCRYPTION_KEY` dipakai konfigurasi Restic/Rclone existing dan terkait repository behavior mode yang digunakan. Agent secret/identity dan per-repository password mempunyai lifecycle terpisah. Jangan overwrite atau regenerate nilai mana pun saat upgrade.

Missing, corrupt, atau conflicting persisted key harus fail-closed. Pulihkan key/config yang asli dari backup privat konsisten. Mengganti environment agar startup lewat dapat membuat credential/snapshot existing tidak dapat dipakai.

## UI dan logs

Database, recovery target, dan notification passwords bersifat write-only. Configured marker bukan plaintext secret. Logs/API menggunakan safe stage/error category; jangan meminta raw config, HMAC, lease token, SQL, decrypted storage options, atau `.env` untuk public support.

## Rotasi operasional

Credential lama yang pernah di-hardcode pada script SYS MON perlu inventaris dependency privately, membuat replacement account least-privilege, menguji backup/recovery, mengubah consumer pada maintenance window, lalu revoke credential lama setelah verifikasi. Ini kerja manual infrastructure yang memerlukan approval; task coding tidak mengedit script/server production.

Rotasi master encryption keys membutuhkan migration/re-encryption procedure khusus, bukan sekadar mengganti environment. Jangan menganggap rotasi password service otomatis memutar repository password atau agent HMAC identity.
