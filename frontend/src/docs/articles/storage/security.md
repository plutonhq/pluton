# Isolasi repository dan kapasitas

## Boundary

Setiap managed remote repository terikat ke plan, agent, storage, dan destination metadata. Parent snapshot dipilih dari repository yang sama dan plan/source/host kompatibel. Jangan memakai satu target yang sama untuk dua lifecycle atau mencampur repository legacy dengan managed init/retention.

Repository credentials harus hanya memberi akses yang diperlukan pada tujuan. Source agent perlu read/traverse, bukan write source. Server staging/workspace membutuhkan write di area private miliknya, bukan seluruh storage/live source.

## Encryption

Restic repository password melindungi repository. `SECRET` melindungi stored application credentials dan `ENCRYPTION_KEY` mempunyai peran konfigurasi Restic/Rclone existing. Ketiganya tidak saling menggantikan. Kehilangan key dapat membuat config tidak dapat didekripsi walau blob repository masih ada.

## Capacity dan retention

Pantau physical storage, quota, inode, cache, SQLite/WAL, restore downloads, dan recovery workspace. Snapshot size merupakan logical size; beberapa snapshot dapat berbagi blocks yang sama. Retention managed dan provider lifecycle harus direview terpisah; remote jangan diasumsikan menjalankan setiap opsi lokal.

## Larangan

Jangan `chmod 777`, membuat source/repository writable oleh service account yang tidak perlu, auto-unlock legacy, atau menghapus snapshot untuk mengatasi error preparation. Ikuti [security boundaries](/docs/security/boundaries) dan log diagnostic yang sanitized.
