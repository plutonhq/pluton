# Backup Now dan Backup History

## Menjalankan job

**Backup Now** membuat pekerjaan dan UI membaca progress nyata. Stage dapat validating-source, preparing-database, dumping-database, preparing-repository, backing-up, verifying-snapshot, lalu completed. Bila Restic belum memberikan total valid, UI indeterminate; tidak dibuat persentase palsu.

## Membaca hasil

Backup History memperlihatkan terminal status, duration, New/Modified/Unmodified counters, logical Snapshot Size, dan exact snapshot binding. Buka backup detail/event panel untuk Data Added dan Compressed Data Added. Restic summary tidak menyediakan deleted-files counter: **Not measured** bukan nol file terhapus.

Completed dengan cleanup warning berarti snapshot sukses tetapi post-hook/temporary cleanup perlu ditinjau. Error raw process tidak diteruskan; gunakan safe stage/code serta IDs untuk korelasi journal/server log.

## Aksi sesudah backup

Browse, Download, Restore, dan Test Recovery memakai backup/snapshot yang dipilih, bukan `latest` yang bisa berubah saat job baru berjalan. Recovery status terpisah dari Complete. Notifications adalah delivery terminal-event terpisah; delivery failure tidak membatalkan snapshot.

## Jangan lakukan

Jangan mengedit snapshot ID/counters di SQLite, menghapus snapshot untuk mengubah New Files, atau menganggap repository growth sama dengan total logical size. [Panduan incremental](/docs/backup-plans/incremental) menjelaskan perbedaannya.
