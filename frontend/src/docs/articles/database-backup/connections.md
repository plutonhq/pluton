# Koneksi, TLS, dan credential

## Dua mode transport

`local` hanya menerima loopback localhost/127.0.0.1/::1; bukan plaintext ke sembarang trusted-LAN DB. `verify-identity` mewajibkan certificate hostname dan CA trust. Server DB pada host lain harus menyediakan transport terverifikasi; jangan disable TLS supaya login berhasil.

DNS, port, firewall, dan CA store dibangun operator. Hostname certificate harus cocok dengan connection field. Socket-path, DSN, arbitrary credential-file path, dan client flags tidak diterima dari plan.

## Credential terpisah

Setiap entry mempunyai password terenkripsi dan plan-scoped stable ID. Backup account bukan recovery import account. API/UI tidak mengembalikan plaintext. Private client defaults/pgpass files hanya hidup pada job workspace, mode 0600, dan dihapus sebelum Restic/post-hook.

## Reorder dan edit

Password terikat databaseId, bukan posisi array. Menambah entry memerlukan credential sendiri; removal menghapus binding entry tersebut, bukan seluruh collection. Saved-secret flag dari client tidak membuktikan credential ada.

## Diagnostik

Pisahkan authentication, insufficient privileges, connection, TLS, timeout, client missing, invalid config, dan generic dump failure. Jangan mengirim password, raw stderr/SQL, atau connection config ke public report. [Kasus login succeeds/dump fails](/docs/troubleshooting/database) sering berkaitan privilege, bukan password.
