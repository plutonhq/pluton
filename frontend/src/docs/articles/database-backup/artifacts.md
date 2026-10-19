# SQL artifact dan konsistensi

## Layout stable

SQL diarsipkan sebagai `/pluton/database/<filename>.sql` dalam snapshot yang sama dengan source canonical. Workspace lokal random/private tidak tampil sebagai logical SQL restore path; metadata snapshot input paths tetap mencatat workspace tersebut untuk audit Restic.

Completion mencatat databaseId, engine, logical database, artifact path, byte length, dan SHA-256. Filenames dan identities collection harus unik. Credentials bukan bagian snapshot artifacts; temporary defaults/pgpass dihapus sebelum backup.

## Validasi

Agent memastikan full snapshot ID, owning plan/backup tags, source tree, dan setiap SQL artifact dengan exact size sebelum completion. Recovery menghitung SHA-256 archived artifact sebelum import. Hash valid membuktikan artifact yang dicatat tidak berubah, bukan query/business data semantik otomatis benar.

## Incremental

Dump dapat mempunyai timestamp/header atau konten berubah tiap run. File SQL tersebut dapat counted Modified sementara filesystem aplikasi Unmodified. Recreated file metadata juga berpengaruh; data blobs identik tetap dideduplicate. Jangan mengurangi counters secara arbitrer untuk menampilkan ratio lebih bagus.

## Recovery manual

Browse/download/restore exact snapshot, simpan artifacts di staging privat, dan import hanya ke target test terisolasi yang disetujui. Plain SQL dapat mengandung confidential data; jangan publikasi dump/hash-associated inventory. [Recovery Test](/docs/recovery-testing) mempunyai semantic limitations yang eksplisit.
