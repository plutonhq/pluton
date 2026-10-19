# Subscriptions global dan per-plan

## Intersection

Channel event selection membatasi jenis event yang bisa dikirim. Per-plan policy memilih enabled, channel IDs, dan event types; delivery harus memenuhi kedua selection. Channel yang disabled atau tidak lagi subscribed tidak mengirim pending work yang belum in-flight.

## Save terpisah

Simpan Backup Plan terlebih dahulu, lalu save notification policy eksplisit. Policy tidak digabung secara diam-diam ke raw plan settings. Mengedit channel secret/config menaikkan revision; pending delivery yang menggunakan revision lama tidak dikirim dengan config yang berubah tanpa review.

## Activation floor

First enable, re-enable, atau perubahan selection mencatat monotonic source creation floor. Historical job dan job yang sudah running sebelum enable tidak ikut replay. Setelah semua prerequisites siap, buat job test baru untuk membuktikan delivery; jangan meminta mass historical resend sebagai acceptance.

## Test actions

Send Test Webhook/Email menguji channel configuration terlepas dari terminal backup event. Delivery queued bukan success akhir. Policy intersection tetap perlu test backup/recovery baru.

## Delete/retry

Delete menghapus secret dan association secara aman sambil mempertahankan bounded history references. Manual retry, bila eligible, memakai channel revision terkini yang direview. In-flight HTTP/SMTP tidak bisa ditarik kembali setelah sudah dikirim.
