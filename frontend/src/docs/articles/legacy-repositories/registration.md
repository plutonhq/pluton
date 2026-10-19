# Registrasi dan snapshot historis

## Registrasi

Pada **Legacy Repositories**, masukkan repository filesystem lokal yang diizinkan server serta password melalui authenticated UI. Ini bukan pembuatan repository. Credential disimpan terenkripsi; registration validation tidak melakukan init/re-key/tag.

Jangan menyertakan URL password, key material, raw dump DB, atau internal infrastructure inventory pada public support/report. Operator menentukan mount/permission read-only dan menjaga repository terpisah dari backup plans baru.

## Snapshot list

Adapter memberi historical snapshots, hostname/path/tag/time metadata sesuai repository. Gunakan filter untuk menemukan snapshot yang diperlukan, lalu pilih exact ID untuk Browse/Restore. Filtering tampilan tidak memodifikasi metadata.

## Statistik

Mode stats menunjukkan semantics Restic inspection yang digunakan, bukan total disk growth hasil penjumlahan logical snapshot sizes. Physical usage membutuhkan storage measurement. Legacy New/Modified metadata hanya ada jika snapshot format menyimpannya; jangan invent parent/counter historis.

## Gagal membuka

Wrong password, missing path, access denied, unsupported output/version, atau lock contract failure harus ditinjau. Jangan mendaftarkan ulang ke managed plan, memberi write permission, atau menjalankan unlock/repair otomatis agar UI terbuka.
