# SMTP relay dan TLS

## Channel

Set host, port, sender, 1–20 recipients, optional username/password, timeout, security mode, dan network policy. Tanpa username, authentication tidak dipaksakan. Saved password tidak ditampilkan ulang; preserve/replace/clear dilakukan eksplisit.

## TLS

STARTTLS mewajibkan upgrade TLS; implicit TLS memulai TLS sejak koneksi. Certificate CA/hostname diverifikasi, TLS minimum 1.2. `plain` hanya pada trusted-LAN policy/CIDRs yang disetujui, bukan fallback saat certificate invalid. DNS IP dipin dengan identitas hostname tetap diverifikasi.

Relay dengan private certificate membutuhkan trusted CA setup server yang benar. Jangan `rejectUnauthorized: false`, downgrade transport, atau grant broad relay access untuk membuat test lolos.

## Test Email

Send Test Email menghasilkan queued delivery; periksa actual Delivery History sampai delivered/failed. SMTP accepted berarti relay menerima, bukan garantied inbox delivery. Periksa recipient policy, relay queue/spam/auth secara privat.

## Compatibility

Old integration SMTP kini juga memakai verified TLS; relay lama tanpa TLS/trusted certificate dapat memerlukan reconfiguration aman. Legacy path tidak dimigrasi diam-diam ke durable subscriptions. Nonaktifkan duplicate event path bila memilih channel baru.

Live relay acceptance belum dilakukan oleh task ini. Gunakan [troubleshooting notifications](/docs/troubleshooting/notifications) untuk klasifikasi certificate/auth/recipient errors.
