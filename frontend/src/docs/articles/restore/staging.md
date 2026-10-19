# Staged Restore dan verifikasi manual

## Target

Managed remote membuat workspace privat baru di data directory server. Custom target, bila dipilih, adalah subfolder di workspace yang sama, bukan absolute host/source path. Backend menjaga containment, no overlap dengan source/repository, dan never-overwrite. Existing destination tidak dihapus untuk membuat restore berhasil.

## Preview

Periksa exact snapshot, selected file/directory counts, bytes yang diperlukan, serta destination. Source canonical tidak berubah karena restore dijalankan server; tidak ada agent contact untuk menulis balik ke source.

## Verifikasi manual

Restore ke staging, bandingkan expected files/directories, permissions, byte counts, dan artifact hashes. Validasi konfigurasi aplikasi secara privat. Bila SQL dibutuhkan, import ke database test terisolasi dengan credential terpisah; jangan memakai host/database produksi dalam UI Recovery Test.

Copy dari staging ke deployment baru/cutover adalah operasi administrator di luar automated restore ini. Tidak ada automatic application start, DNS switch, production SQL replacement, atau restore-to-original-source.

## Cleanup

Gunakan aksi cleanup/remove job yang didukung dan exact workspace ownership. Jangan recursive-delete `/data` atau repository karena restore failure. Cleanup warning perlu investigasi kapasitas/permissions dan memastikan data SQL staging tetap privat.
