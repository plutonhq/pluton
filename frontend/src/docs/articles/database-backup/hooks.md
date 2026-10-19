# Pre/Post Backup Hooks

## Kontrak remote

Hook adalah ID executable di administrator-owned hook root, optional allowlisted args, dan timeout. Bukan text shell command dari Web UI. Root default `/etc/pluton-agent/hooks`; executable serta ancestors tidak boleh writable oleh agent atau group/other. Agent berjalan non-root dan memakai `shell: false`.

## Urutan

Plan-level pre-hook berjalan sekali sebelum dumps. Dump setiap DB lalu Restic backup/confirmation. Post-hook cleanup diusahakan setelah operation, termasuk failure/cancellation, agar aplikasi dapat dipulihkan dari quiesce. Karena process dapat crash atau host mati, operator tetap perlu fail-safe aplikasi sendiri.

## Failure

Pre-hook failure mencegah backup. DB dump failure mencegah Restic, lalu cleanup/post diusahakan. Post-hook failure setelah snapshot sukses menjadi lifecycle warning, bukan rollback snapshot. Timeout menghentikan process group; raw stdout/stderr tidak dikirim sebagai diagnostic publik.

## Penggunaan aman

Review root-owned executable independen, privileges minimum, idempotency, bounded runtime, dan bagaimana operator mengembalikan layanan bila post-hook tidak berjalan. Jangan taruh passwords/tokens dalam args atau script contoh.

Local legacy script settings mempunyai kontrak lain dan tidak diwariskan menjadi arbitrary remote shell. Tidak ada built-in app-specific maintenance automation yang dijanjikan docs ini.
