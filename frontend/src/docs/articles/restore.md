# Memilih exact snapshot

## Binding

Pilih baris Backup History yang Completed, kemudian Browse, Download, Restore, atau Test Recovery. Aksi managed remote mengikat plan, backup job, repository, dan full Restic snapshot ID. Jangan mengganti binding menjadi `latest` ketika snapshot baru bisa dibuat bersamaan.

## Mode restore

Managed remote Restore dan Legacy Restore selalu ke staging privat pada Pluton Server. Tidak ada restore-to-original untuk remote agent. Local historical restore mempunyai kontrak berbeda; baca dialog destination/overwrite dengan teliti dan jangan menyamakannya dengan guard staging remote.

## Akses

Server membaca repository untuk Browse/Download/Restore; source agent tidak perlu dikontak untuk recovery managed remote. Storage/repository credentials tetap diperlukan dan TLS/network harus valid. Snapshot yang sudah hilang atau metadata tidak sesuai binding ditolak, bukan diganti snapshot lain.

## Verifikasi

Tinjau file count, directories, bytes, selected paths, target staging, dan hasil cleanup. Untuk aplikasi, lakukan manual validation/import di lingkungan terisolasi sebelum cutover. Successful restore bukan otomatis aplikasi production siap jalan.

Lanjutkan ke [Browser/Download](/docs/restore/browse), [selection](/docs/restore/selection), dan [staging](/docs/restore/staging).
