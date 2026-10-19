# FAQ operator

## Mengapa snapshot besar tetapi repository kecil?

Logical snapshot merepresentasikan semua file. Compression dan content reuse membuat physical repository jauh berbeda. Ukur physical storage langsung; jangan infer ratio dari New Files atau menjumlahkan logical snapshots.

## Perlu recreate plan setelah fix?

Tidak untuk hardening ini. Existing plan, storage, identity, repository/password, snapshot IDs, recovery records, dan Phase 7 subscriptions/outbox dipertahankan. Agent code update diperlukan untuk parent execution fix.

## Apakah docs perlu Internet atau login?

Tidak. Static article/search bundle tersedia di instance `/docs` sebelum login tanpa inventory/API data. External reference links hanya dibuka bila operator memilihnya. Refresh nested path memakai SPA fallback yang sama.

## Mengapa backup Complete tapi Recovery warning?

Backup dan Recovery independent. Artifact bytes/hash passed dengan SQL import Disabled berarti SQL NOT TESTED. Cleanup incomplete juga warning yang perlu review.

## Apakah bisa upgrade ke paid edition?

Fork ini tidak menyediakan commercial activation/checkout. Unsupported actions dijelaskan sebagai capability limitation, bukan subscription offer. Attribution upstream tetap di About.

## Rujukan Restic

Semantics publik dapat diverifikasi pada [Restic backup documentation](https://restic.readthedocs.io/en/stable/040_backup.html) dan [JSON scripting reference](https://restic.readthedocs.io/en/stable/075_scripting.html). Semantics versi 0.19.1 diverifikasi melalui native fixture serta source bertag; stable docs dapat bergerak saat release baru. Artikel portal ini ditulis independen, bukan salinan manual upstream.
