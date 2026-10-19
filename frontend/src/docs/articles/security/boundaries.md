# Isolasi source, staging, DB, dan endpoint

## Filesystem

Source realpath harus contained allowed root dan tidak overlap agent state. Symlink escape, missing root, unsupported nodes, dan permission failures dibedakan tetapi tetap fail-closed. Installer tidak otomatis chmod/chown/setfacl source. Private binaries root-owned, source read-only bagi agent, temp files 0600 dan workspace 0700.

## Restore

Managed remote dan Legacy Restore menulis staging baru, bukan source. Path containment, never-overwrite, exact snapshot binding, dan ownership validation tetap berlaku. Local historical behavior bukan alasan menurunkan guard remote.

## Database

Dump account, recovery import account, dan application account terpisah. Required import hanya dedicated target dengan marker/grant checks. Ownership lease cleanup tidak memberi hak menghapus DB yang tidak dibuat/diikat test tersebut.

## Outbound endpoint

Webhook/SMTP private target harus explicit CIDRs; IPv4/IPv6 DNS answers semua diperiksa dan koneksi dipin. Loopback, linklocal metadata, multicast, unspecified, redirects, dan credential in URL ditolak. Jangan broad allow arbitrary Rclone/SFTP flags atau network ranges untuk mengatasi connection error.

## Review sebelum deployment

Pastikan immutable image, same data volume/keys, reviewed source revision agent, disposable regression evidence, serta manual production acceptance terpisah. Uji otomatis tidak memberi izin repo maintenance, production cutover, atau TLS/config mutation.
