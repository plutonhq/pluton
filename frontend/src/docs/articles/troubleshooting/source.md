# Source tidak terbaca atau symlink ditolak

## Gejala

Installer/backup melaporkan cannot read allowed root, source-parent-not-traversable, source-root-not-readable, entry-inaccessible, missing, atau symlink escape walau root directory terlihat sehat bagi administrator.

## Penyebab

Service user berbeda dengan root operator. Parent mode 750 tanpa traverse bagi agent, unreadable descendants, symlink ke canonical destination di luar allowlist, missing mount, dan unsupported file type adalah kategori berbeda.

## Diagnostik aman

Jalankan local read-only preflight sebagai pluton-agent dengan source/roots canonical; gunakan `--scan` eksplisit untuk inaccessible descendants. Review symlink → resolved path dan parent yang diblok. Tidak perlu scan besar pada setiap heartbeat.

## Resolusi

Administrator membetulkan allowlist jika source canonical memang intended, atau memberikan ACL read-only minimum pada exact parent/source. Periksa ACL mask/default untuk file baru. Missing mount/type/escape bukan diselesaikan dengan password baru.

## Jangan lakukan

Jangan membuat `/home` seluruhnya allowed, run daemon root, mengubah source owner, chmod 777, atau disable symlink validation. ONLINE tetap tidak membuktikan source readable. [Panduan permission](/docs/remote-agent/permissions) menunjukkan command non-secret yang didukung.
