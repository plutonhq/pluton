# Browse dan staging legacy

## Read-only source

Snapshot listing/browse memakai read-only repository operation allowlist. Staged Restore membaca exact selected snapshot dan menulis hanya destination yang secara eksplisit divalidasi. Repository read-only tidak berarti restore destination read-only.

## Safety

Target adalah workspace owned aplikasi; in-place restore, path escape, repository/source overlap, overwrite/delete, symlink escape, dan unsupported nodes ditolak. No-lock behavior harus tersedia; jangan fallback ke write repository credentials.

## Prosedur

Pilih historical snapshot ID, browse contents, review selection/required disk, kemudian restore ke staging. Verifikasi file/byte/structure serta permissions secara privat. Download individual file dari completed staged job mengikuti ownership/path guards.

## Recovery aplikasi

Migration/cutover ke aplikasi baru adalah tindakan manual di luar Legacy Adapter. Tidak ada managed auto-recovery hook, SQL auto-import, retention, scheduler, atau restore-to-original-source lewat registration legacy.

## Error dan cleanup

Fail-closed saat target tidak aman atau snapshot missing. Jangan mengubah snapshot atau menghapus repository locks untuk menyelesaikan browser issue. Cleanup dilakukan terhadap owned staging job, bukan directory legacy repository.

Lihat [staging umum](/docs/restore/staging) untuk validation/cutover distinction, tanpa menggabungkan dua lifecycle.
