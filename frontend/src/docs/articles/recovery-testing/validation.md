# Validasi filesystem dan SQL artifact

## Struktur filesystem

Restore memakai workspace private 0700. Exact listing menerima regular files dan directories, lalu actual restored counts/bytes serta listed directories harus cocok. Unexpected paths, missing source tree, traversal, symlinks/special nodes, dan mismatch binding gagal fail-closed.

Ini membuktikan Restic restore dan struktur, bukan full-file SHA-256 comparison terhadap live source atau aplikasi dapat boot. Tidak ada pembacaan source production sebagai pembanding.

## SQL artifacts

Recorded database IDs/engines, reserved paths, bytes, dan SHA-256 diverifikasi sebelum import apa pun. Missing/extra unrecorded SQL, duplicate identities/paths, wrong size/hash, atau malformed metadata tidak disembunyikan sebagai filesystem-only success. SQL file tetap private 0600.

## Resource

Sediakan logical restore bytes ditambah headroom; preflight free-space guard bukan OS quota. Test mempunyai bounded timeout/output/workspace limits. At most satu active recovery per plan dan guard DB lease membantu menghindari konflik.

## Historical metadata

Old filesystem snapshot dapat diuji jika source tree terikat. Old single-DB metadata hanya membuktikan identity yang memang dicatat. Required import tidak menebak missing engine/database/databaseId. Jangan rewrite historical snapshot atau credential untuk melengkapi evidence.
