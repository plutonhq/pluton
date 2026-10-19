# New Files berulang dan progress

## Gejala

Backup successive melaporkan seluruh files New, tetapi physical repository growth kecil. UI dapat indeterminate sebelum Restic mempunyai total size yang valid.

## Penyebab

Default parent bergantung hostname/input paths; private DB workspace acak mengubah metadata paths walau logical artifact layout stable. Content deduplication tetap bekerja. Changing hostname/canonical source/artifact set juga sengaja memulai baseline baru.

## Diagnostik aman

Bandingkan metadata hostname, owning plan tags, canonical source, snapshot paths, dan actual summary pada repository disposable/copy yang authorized. Jangan meminta repository password/public metadata inventory. Counter total_files_processed tidak sama dengan files_new.

## Resolusi

Pasang reviewed agent code parent fix tanpa re-enroll; prior successful receipts diverifikasi terhadap same repository/plan/host/source/artifacts. Bila receipt hilang atau candidate tidak compatible, satu backup baseline aman diizinkan sebelum reuse berikutnya. Server-only deploy mengubah labels, bukan execution agent lama.

## Jangan lakukan

Jangan force arbitrary newest parent, rewrite old snapshots, mengurangi New Files palsu, atau menghitung dedup ratio dari repository/logical sizes yang tidak comparable. Progress tanpa accurate percentage tetap stage/counters nyata. Lihat [incremental reference](/docs/backup-plans/incremental).
