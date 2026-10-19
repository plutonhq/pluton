# Advanced settings dan batas remote

## Mode berbeda

Form mempunyai pengaturan compression, encryption, retention, performance, integrity, scripts, dan replication dari local managed lifecycle. Ketersediaan form atau shared type tidak menjamin outbound Agent menjalankan opsi tersebut. Remote preparation melakukan support checks dan menolak kombinasi yang tidak didukung.

## Encryption dan compression

Managed remote repository memakai password Restic terenkripsi; encryption tidak dimatikan agar backup lolos. Pinned Restic memakai semantics compression format repository yang ada. Jangan mengubah key, repository format, atau CLI flags melalui raw payload.

Snapshot Size tetap logical meskipun compression aktif. Compressed Data Added berasal dari ringkasan Restic, bukan penjumlahan size file atau perkiraan disk usage.

## Database dan hooks

Remote **Database & Hooks** menerima deklarasi allowlisted, bukan arbitrary shell atau client flags. Root-owned hook executable disiapkan administrator. Database clients harus tersedia di agent dan engine advertised. Hook/DB configuration yang valid masih membutuhkan [privileges](/docs/database-backup/dump-options).

## Notification dan recovery

**Webhooks & Email** memakai channels/subscriptions terpisah dari legacy integrations. Save policy per-plan secara eksplisit. Recovery database import hanya ke target recovery-only; jangan menyalin connection source produksi untuk membuat Required import berhasil.
