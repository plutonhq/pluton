# Incremental, parent, dan deduplication

## Dua mekanisme berbeda

Restic content deduplication memakai content blocks: data identik tidak perlu disimpan ulang. Parent snapshot mempercepat change detection berdasarkan path dan metadata file. Deduplikasi tetap bekerja meskipun parent tidak ditemukan; “semua file new” tidak otomatis berarti seluruh byte baru tersimpan.

Default Restic 0.19.1 memilih parent dengan hostname dan input paths yang cocok. Relative DB artifact tetap tampil `/pluton/database/app.sql` dalam snapshot tree, tetapi metadata paths mencatat absolute private job workspace. Workspace acak antar-run sebelumnya menggagalkan default parent matching.

## Parent yang aman

Agent sekarang memakai successful local completion receipts, dibatasi 16 candidate IDs, lalu memeriksa metadata dari repository yang sama: full snapshot/tree ID, single owning plan tag, backup tag, hostname, canonical source, tepat artifact filenames, dan satu historical private job workspace. Timestamp hanya memilih di antara candidates yang sudah kompatibel.

Tanpa receipt atau metadata kompatibel, tidak ada arbitrary parent fallback. Setelah satu successful backup menjadi receipt, backup berikutnya dapat mengoptimalkan parent. Mengganti hostname, canonical source, data-state root, atau set DB artifacts dapat memulai baseline baru. Snapshot lama tidak dimutasi.

## Arti counter

| UI                    | Restic JSON           | Arti                                                      |
| --------------------- | --------------------- | --------------------------------------------------------- |
| Total Files           | total_files_processed | Semua regular files diproses, termasuk SQL artifacts      |
| New Files             | files_new             | Baru terhadap selected parent, bukan newly stored blocks  |
| Modified Files        | files_changed         | Berubah terhadap parent; metadata dapat berpengaruh       |
| Unmodified Files      | files_unmodified      | Tidak berubah terhadap parent                             |
| Snapshot Size         | total_bytes_processed | Logical byte size snapshot                                |
| Data Added            | data_added            | Blob baru sebelum compression                             |
| Compressed Data Added | data_added_packed     | Blob baru sesudah compression, bukan total physical usage |

Deleted files dan actual physical repository usage tidak disediakan backup summary. SQL dump dapat berubah tiap execution walau file aplikasi tetap unmodified. Jangan menghitung deduplication ratio dari file counts. Sumber semantics: [Restic backup](/docs/reference/faq#rujukan-restic) dan panduan scripting resmi.
