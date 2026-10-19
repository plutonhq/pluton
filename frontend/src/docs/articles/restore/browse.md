# Snapshot Browser dan TAR Download

## Browse

Snapshot Browser menampilkan tree dari snapshot yang dipilih, bukan live filesystem. Source absolute dapat muncul sebagai hierarchy lengkap, sedangkan DB artifacts berada di `/pluton/database/...`. Browser/cache tidak mengubah snapshot metadata.

Navigasi directory, filter/search, dan pilihan file harus tetap mengacu ke exact snapshot ID. Unsupported/special nodes dan path traversal ditolak di backend untuk managed remote recovery; mengubah frontend selection tidak memperluas permission server.

## Download

Managed remote **Download** menghasilkan TAR dari full snapshot. Ini bukan preview media berbayar atau arbitrary file-execution service. Download dapat mempunyai logical volume jauh lebih besar daripada repository disk usage terkompresi; sediakan disk/bandwidth.

Jangan membuka/extract archive langsung ke filesystem root atau source production. Gunakan directory staging baru dan review paths/permissions. SQL artifact dalam TAR adalah data sensitif dan tetap perlu proteksi storage lokal.

## Error

Snapshot missing, wrong repository password, network failure, invalid output, timeout, atau storage access error adalah failure nyata. Jangan mengalihkan download ke snapshot `latest` atau menonaktifkan exact binding. Untuk pemulihan terpilih gunakan [Restore selection](/docs/restore/selection), bukan memodifikasi archive snapshot.
