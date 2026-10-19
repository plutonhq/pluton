# Selection dan Recovery warning

## Gejala

Select All terlihat memilih “12/15” karena 12 regular files dan 3 directories. Recovery Passed with warning walau artifact SHA-256 valid dan restore berhasil.

## Penyebab

File content count berbeda dari total entries. DB artifact-only validation tidak menjalankan SQL import ketika Disabled. Cleanup incomplete juga dapat menghasilkan warning; pass lama mungkin untuk snapshot berbeda dari latest backup.

## Diagnostik aman

Review confirmation files + directories + entries, partial selection/ancestor state, exact snapshot binding, result importValidation, bytes/hash, dan workspace/DB cleanup flags. Filter/search tidak berarti global selection berubah.

## Resolusi

Gunakan labels entry-aware; verify restored file/dir count terpisah. Provision dedicated target dan Required import hanya jika semantic DB validation diperlukan. Tinjau cleanup ownership sebelum manual maintenance. Historical missing identity tidak diisi dengan tebakan.

## Jangan lakukan

Jangan menampilkan import Disabled sebagai Passed semantic recovery, drop production DB, restore ke original source, atau memakai latest recovery pass untuk snapshot baru. [Result semantics](/docs/recovery-testing/results) menjelaskan evidence yang benar-benar ada.
