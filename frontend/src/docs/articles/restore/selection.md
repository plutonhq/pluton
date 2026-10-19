# Select All, file, dan directory

## Semantics

Confirmation membedakan regular files, directories, selected entries, dan total entries. Contoh sintetis: 12 files + 3 directories berarti 15 filesystem entries, bukan 15 regular files. File restore progress tidak menghitung directory sebagai file konten.

## Select All

Select All mencakup seluruh listing snapshot, bukan hanya baris search yang sedang terlihat. Directory ancestors dipertahankan bila child masih dipilih, termasuk empty directories yang dipilih. Search/filter adalah tampilan; tidak boleh menyembunyikan selection yang sebenarnya dikirim.

## Partial selection

Memilih directory memilih subtree. Membatalkan parent menghapus subtree dari selection; memilih child di bawahnya mengembalikan ancestor yang dibutuhkan. Tri-state partial/all/none membantu membedakan parent yang hanya sebagian dipilih. Review confirmation setelah toggle parent/child, tidak hanya row count viewport.

## Backend boundary

Backend memvalidasi selection terhadap exact snapshot nodes, bukan percaya label count frontend. Traversal, duplicate/unsafe paths, unsupported type, overlap, dan overwrite target guard tetap berlaku.

## Setelah restore

Periksa result regular file count/bytes dan keberadaan directories. Jika UI count berbeda, bandingkan klasifikasi file versus directory terlebih dahulu; jangan menghapus directory dari snapshot agar angka terlihat cocok. [Staging](/docs/restore/staging) tetap tempat validasi manual.
