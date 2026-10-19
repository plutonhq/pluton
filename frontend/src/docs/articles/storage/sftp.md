# SFTP dan pemetaan path

## Path efektif

Rclone remote root mengikuti home yang terlihat dalam sesi SFTP, bukan otomatis filesystem root host. Contoh sintetis: chroot `/srv/sftp/app-01`, home `/repo`, destination plan `daily`. `pluton:daily` menunjuk `/repo/daily` di sesi dan physical `/srv/sftp/app-01/repo/daily` pada server SFTP.

Plan destination path adalah path repository itu sendiri; aplikasi tidak otomatis menambahkan `/repo` berdasarkan nama storage. SSH Path Override kosong tidak berarti absolute `/`. Verifikasi `pwd`, `ls /`, dan listing destination menggunakan account/config yang sama, tanpa membagikan credential.

## Subset remote

Remote preparation meneruskan host, port, username, dan password yang dilindungi. Agent mengubah password plaintext materialized menjadi representation obscured yang Rclone harapkan hanya untuk temporary config. Obscure bukan encryption at rest pengganti Cryptr.

Advanced command, external SSH executable, SSH agent, arbitrary key/config path, dan non-default dangerous options tidak dibuka supaya pilot lolos. Default normal UI dinormalisasi, sedangkan field unsafe dilaporkan hanya nama/rule, bukan nilainya.

## Repository safety

Missing destination berarti init diizinkan. Non-empty destination menolak init. Jangan melemahkan guard atau menghapus isi directory untuk mengatasi authentication/permission error. Lihat [troubleshooting SFTP](/docs/troubleshooting/sftp).
