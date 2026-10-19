# Administrator dan Dashboard

## Autentikasi awal

Container memakai `USER_NAME` dan `USER_PASSWORD` yang diberikan operator secara privat. `SECRET`, `APIKEY`, serta credential control plane dipertahankan dalam data/config sesuai installation mode. Desktop mempunyai Setup flow terpisah; jangan menganggap route Setup mengganti konfigurasi Docker.

Setelah login, gunakan password kuat, batasi akses network, dan pertimbangkan 2FA dari Settings. Jangan mempublikasikan screenshot konfigurasi atau QR setup. Kehilangan key encryption tidak diselesaikan dengan membuat key baru.

## Navigasi

**Backup Plans** menunjukkan workload dan riwayat; **Sources** menunjukkan mesin/agent; **Storages** mengatur destination; **Legacy Repositories** khusus repository existing read-only. **Settings** memuat konfigurasi, self-backup, integrasi lama, dan **Webhooks & Email**. Dokumentasi tersedia melalui sidebar/footer.

## Membaca status

Workflow label tidak selalu live status. Tinjau latest Backup History, progress stage, snapshot ID, dan Recovery badge. Complete berarti snapshot selesai; Recovery Not tested atau warning tetap perlu ditindaklanjuti. Agent ONLINE berarti heartbeat baru diterima, bukan jaminan seluruh source/file readable.

Dashboard tidak menggantikan pemeriksaan storage, restore drill, dan review [operasional harian](/docs/operations). Dokumentasi publik tidak menampilkan inventory atau konfigurasi instance.
