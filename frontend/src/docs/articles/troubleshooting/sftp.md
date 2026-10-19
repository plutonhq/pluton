# SFTP path, permission, dan transport

## Gejala

Login/Storage creation sukses tetapi repository init gagal, destination missing, target non-empty, atau target-check auth/access/transport failure.

## Penyebab

SFTP home/chroot mapping berbeda dari physical root, parent traverse/write permissions belum sesuai, password representation salah, unsafe non-default option, certificate/network/config failure. “Directory not found” untuk target berbeda dari missing config atau auth failure.

## Diagnostik aman

Pada sesi yang sama, periksa `pwd`, `ls /`, dan expected relative destination. Dengan protected config yang sama, bandingkan root versus destination listing; jangan kirim config/password. Review rejected field name/rule category dan stage/code.

## Resolusi

Target missing atau empty boleh lanjut Restic init. Target non-empty harus fail-closed. Auth/access/network errors harus dibetulkan sebelum init; tidak dianggap empty. Remote validator hanya normalisasi safe UI defaults, tidak membuka arbitrary SSH/Rclone options.

## Jangan lakukan

Jangan recreate plan yang path-nya sudah benar, overwrite destination, delete parent `/repo`, chmod 777, atau weaken non-empty guard. Contoh mapping [SFTP](/docs/storage/sftp) memperlihatkan home-relative target dan physical correspondence dengan nama sintetis.
