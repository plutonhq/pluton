# Istilah penting

| Istilah         | Makna operasional                                                   |
| --------------- | ------------------------------------------------------------------- |
| Backup Plan     | Kebijakan satu workload: source, destination, schedule, settings    |
| Repository      | Penyimpanan Restic terenkripsi; bukan SQLite control database       |
| Snapshot        | Representasi data pada satu backup; identitas immutable dari Restic |
| Parent snapshot | Snapshot kompatibel untuk optimasi change detection                 |
| Deduplication   | Reuse content blocks yang sama, bukan rasio dari file counter       |
| Staging         | Workspace restore privat, bukan live source                         |
| Remote Agent    | Service non-root yang poll pekerjaan outbound                       |
| Allowed root    | Batas canonical source yang diizinkan administrator host            |
| SQL artifact    | Dump DB yang diarsipkan di snapshot dengan bytes/SHA-256            |
| Recovery Test   | Restore dan validasi exact snapshot, terpisah dari backup           |
| Outbox          | Delivery notifikasi persistent dengan lease dan retry               |

## Ukuran yang berbeda

Logical Snapshot Size menghitung isi yang direpresentasikan snapshot. Data Added menghitung blob baru sebelum compression; Compressed Data Added sesudah compression. Disk usage repository harus diukur pada storage. Menjumlahkan logical size banyak snapshot tidak menghasilkan physical disk usage.

## Identity yang berbeda

Plan ID, backup job ID, Restic snapshot ID, stable database ID, dan notification event ID mempunyai fungsi berbeda. Jangan memakai client-only temporary database card ID sebagai persisted `db_...` identity. Saat restore/recovery/notifikasi, gunakan snapshot yang benar-benar terikat pada backup tersebut.
