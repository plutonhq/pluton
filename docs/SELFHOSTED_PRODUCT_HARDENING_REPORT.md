# Self-hosted Product Hardening Report

Tanggal: 2026-10-13. Branch: `codex/selfhosted-product-hardening-docs`.
Base yang ditinjau: `bd9373d` (merge Phase 7, PR #25); Operational Hardening
sudah ada melalui merge `600381e`. Working tree awal bersih.

Ini **post-Phase-7 hardening**, bukan fase roadmap baru. Semua perubahan masih
uncommitted. Tidak ada commit, push, merge, release, deployment, production
access, secret rotation, perubahan ACL production, atau repository production
yang disentuh. Seluruh data uji disposable/sintetis. Angka workload pilot tidak
disalin menjadi fixture, inventori, atau acceptance evidence.

## Ringkasan keputusan

| Area                                             | Hasil                          | Bukti/batas                                                                                                  |
| ------------------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Repeated New Files filesystem + DB               | Fixed                          | Direproduksi dengan Restic 0.19.1 nyata; parent terverifikasi mengembalikan change tracking aplikasi         |
| Content deduplication/snapshot tree              | Already correct, dipertahankan | Reproduksi lama tetap tidak menulis content blobs identik; staged restore/hash cocok                         |
| Replay snapshot statistics                       | Fixed                          | Lost local receipt memakai real snapshot summary, bukan angka nol buatan                                     |
| UI change/logical/packed statistics              | Fixed                          | Counter berbeda, unknown tetap unknown, latest completed snapshot, failed attempt tidak menjadi chart sample |
| Commercial/upstream product dependencies         | Fixed/scoped                   | Footer/help lokal, tidak ada upstream update query/script execution atau decorative CDN images               |
| Apache-2.0/upstream acknowledgement              | Retained                       | LICENSE, author/package identities, history dan technical acknowledgements dipertahankan                     |
| Built-in documentation                           | Implemented                    | 77 artikel asli Bahasa Indonesia, 15 kategori, `/docs`, local search dan safe React renderer                 |
| Identity, credentials, managed/Legacy boundaries | Preserved                      | Tidak ada schema/wire migration, credential regeneration atau Legacy mutation                                |
| Phase 5/6/7 regression                           | Passed locally                 | Native disposable fixtures; bukan production certification                                                   |
| Frontend lint                                    | Baseline blocked               | Existing ESLint configuration gagal sebelum memeriksa source; tidak disembunyikan                            |
| Live Phase 7 acceptance/infrastructure           | Deferred                       | Tetap memerlukan domain/certificate/receiver/SMTP relay dan persetujuan operator                             |

## A. Incremental backup: audit, root cause, dan fix

### Call path yang diperiksa

`RemoteBackupService` materializes managed SFTP command dan encrypted plan
credentials. Agent memverifikasi command, memakai canonical allowed source,
menjalankan `BackupLifecycleJob.prepare()`, membuat private Rclone config,
menyiapkan managed repository, kemudian menjalankan Restic. Restic JSON summary
dikonfirmasi dengan exact snapshot, diteruskan melalui completion callback,
disimpan sebagai `completion_stats`, lalu dipakai PlanStore/API/frontend.
Pre/Post Hooks, sequential multi-DB dumps dan artifact cleanup tetap pada
lifecycle yang sama.

Temuan sebelum perubahan:

- Source filesystem sudah canonical dan stabil; tidak diganti menjadi arbitrary
  relative live-source path.
- Default hostname berasal dari OS; tidak ada random hostname per backup.
- SQL dump menggunakan private per-job workspace yang berbeda tiap run. Argumen
  artifact adalah relative `pluton/database/app.sql`; Restic berjalan dengan
  `cwd` workspace tersebut.
- Snapshot tree SQL sudah stabil di `/pluton/database/app.sql`. Namun **metadata
  snapshot `paths` menyimpan absolute input path**, termasuk workspace acak.
- Tidak ditemukan `--force` atau workaround inode/ctime untuk mengatasi kasus ini.
- Backend primary mapping memang memakai `files_new`, bukan
  `total_files_processed`. Jadi gejala utamanya bukan penukaran field UI.
- Ada bug sekunder: fallback successful replay tanpa local receipt membuat
  summary semua nol, dan UI menampilkan deleted-files nol walau tidak diukur.
- Remote plan size sebelumnya bisa berasal dari historical maximum/attempt
  estimates, bukan latest completed logical snapshot.

Restic menjelaskan default parent grouping `host,paths` serta absolute metadata
paths meskipun tree dibangun dari relative paths. Ini konsisten dengan hasil
native test, bukan bukti akses ke pilot production.
[Restic backup/change detection](https://restic.readthedocs.io/en/stable/040_backup.html).

### Reproduksi native

Fixture disposable berisi dua file aplikasi sintetis dan satu SQL artifact.
Repository, password acak, source, serta private workspaces hanya hidup pada
temporary test storage. Password tidak ada dalam argv/output report.

| Kondisi                            | Metadata input                                | Parent                                | Real Restic outcome                                  |
| ---------------------------------- | --------------------------------------------- | ------------------------------------- | ---------------------------------------------------- |
| Run lama pertama                   | Source + `jobs/job-a/pluton/database/app.sql` | Tidak ada                             | 3 new files                                          |
| Run lama kedua, konten sama        | Source + `jobs/job-b/pluton/database/app.sql` | Tidak ada                             | 3 new files lagi; 0 new data blobs                   |
| Run fixed, dump dipersiapkan ulang | Source + private workspace baru               | Verified previous successful snapshot | 0 new, 1 changed SQL, 2 unmodified application files |

Deduplikasi konten **tidak rusak** pada reproduksi lama. Tree/content snapshot
juga tidak rusak: SQL dapat di-browse/download/restore dengan path dan hash yang
benar. Tree blobs/metadata tetap dapat bertambah; 0 data blobs bukan klaim bahwa
seluruh repository overhead bernilai nol.

### Exact fix dan boundary

`agent/src/resticParent.ts` melakukan selection dari local persisted successful
completion receipts, bukan parent ID dari command/server/user input.

1. Ambil maksimal 16 unique full snapshot IDs dari receipts `success=true`.
2. Baca metadata IDs itu dari **repository yang sedang digunakan**, menggunakan
   credential context yang sama, melalui bounded `snapshots --json --no-lock`.
   Lookup dibatasi 60 detik dan sekitar 1 MiB text output; tidak scan semua
   snapshot history.
3. Wajib cocok: full 64-hex snapshot/tree ID, valid non-future timestamp, current
   hostname, tepat satu owning `pluton-plan-<id>` tag, backup tag, exact canonical
   source, exact artifact set/count, dan satu normalized historical `job-...`
   workspace di bawah canonical current data-state `jobs` root.
4. Timestamp hanya memilih di antara metadata yang **sudah compatible dan
   berhasil menurut receipt**. Snapshot newest-but-failed/unreceipted, plan lain,
   host/source lain, escaping path, atau changed artifact set ditolak.
5. Jika cocok, backup memakai `--parent <verified-id> --group-by host` dan explicit
   OS hostname. Jika tidak, `--group-by host,paths,tags` dengan unique backup tag
   mencegah implicit cross-plan fallback.
6. Source allowed-root recheck, private job directory, root-owned binaries,
   write-only DB credentials, snapshot tree layout dan cleanup tidak diubah.

Parent selection adalah read-only preparation untuk **managed backup**. Legacy
Adapter tidak masuk ke jalur ini. Tidak ada `forget/prune/unlock/migrate/repair`
baru, historical snapshot rewrite, fabricated file counters, global source
ownership change, `shell:true`, atau new agent wire fields.

Local receipt history existing bounded; candidate pool hanya 16. Receipt yang
hilang/terevict, repository/hostname/source/state-root/artifact-set yang berbeda
boleh menghasilkan satu safe no-parent baseline. Setelah successful receipt
compatible tersedia, run berikutnya bisa memakai parent. SQL dump dapat benar-
benar changed tiap run karena konten/metadata dump; tidak dipaksa unmodified.

### Replay statistics

Jika exact backup tag sudah mempunyai snapshot tetapi local receipt tidak
tersedia, `summaryForExistingSnapshot` memakai **stored Restic snapshot summary**:
12 measured numeric counters divalidasi finite/nonnegative, snapshot ID asli
dipertahankan, duration diturunkan dari stored backup timestamps.

Missing/malformed summary menghasilkan sanitized `restic-summary-missing`;
tidak dikonversi menjadi sukses dengan zero statistics dan tidak redump/rebackup
snapshot tersebut. Native Phase 5 test memverifikasi replay tidak membuat SQL
dump atau snapshot tambahan dan measured counters sama dengan hasil pertama.

### Semantics UI dan email

| Label                                 | Sumber                  | Tidak boleh disamakan dengan               |
| ------------------------------------- | ----------------------- | ------------------------------------------ |
| Total Files                           | `total_files_processed` | Directory/total filesystem entries         |
| New Files                             | `files_new`             | Newly stored content blocks                |
| Modified Files                        | `files_changed`         | Semua processed files                      |
| Unmodified Files                      | `files_unmodified`      | Files deleted                              |
| Snapshot Size                         | `total_bytes_processed` | Physical repository usage                  |
| Data Added                            | `data_added`            | Total repository logical size              |
| Compressed Data Added                 | `data_added_packed`     | Complete physical repository/pack overhead |
| Deleted Files                         | Not measured            | Fabricated zero                            |
| Physical repository usage/dedup ratio | Not measured            | Estimate from New Files                    |

JSON field meanings follow the public Restic interface.
[Restic scripting JSON summary](https://restic.readthedocs.io/en/stable/075_scripting.html).

Remote table/detail/plan widgets memakai measured completion values. Plan size
dan sorting memakai latest completed logical snapshot, bukan historical maximum.
Remote chart mengabaikan failed/running/unknown attempts dan tidak menggandakan
satu snapshot menjadi dua samples; missing counters menjadi null/Not measured.
Local/sync values dan sync-specific removed-files behavior dipertahankan;
sync chart tetap berlabel Size, bukan Restic Snapshot Size.

Legacy email success/started file counters juga diperbaiki agar tidak menjumlah
regular files dengan directories. Started size tetap estimated; Deleted Files
berlabel Not measured. Existing live stage/indeterminate progress dari
Operational Hardening dipertahankan, tidak dibuat percentage baru.

## B. Product cleanup report

| Reference/call sebelum                                                   | Perubahan                                                                                 | Alasan/boundary                                                       |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Footer upstream docs/site, Upgrade, Update Available, upstream changelog | Local Documentation, Changelog, Version, About                                            | Application-owned navigation                                          |
| Router latest-version query + GitHub upstream latest-release request     | Query dihapus; existing backend compatibility endpoint returns null                       | Tidak ada independently trusted fork update feed                      |
| `dl.usepluton.com` downloaded updater scripts + license query in URL     | BaseSystemManager returns safe unavailable/manual-update response                         | Tidak menjalankan unsigned script atau mengirim license di URL        |
| PRO/Business advertising modal/styles                                    | Small Feature availability compatibility dialog; advertising stylesheet dihapus           | Unsupported action tetap disabled, bukan commercial unlock            |
| Snapshot placeholder preview/download upsell                             | Dihapus; actual managed Browse/Download/staged Restore dipertahankan                      | Tidak mengklaim fitur preview yang belum diimplementasikan            |
| Storage setup links ke upstream docs                                     | Local SFTP/S3/storage articles                                                            | Help mengikuti kemampuan fork sebenarnya                              |
| New Devices commercial build flag                                        | Public outbound agent capability enabled                                                  | Existing public Phase 4 implementation, bukan proprietary gate        |
| Email decorative CDN images dan Ntfy upstream icon                       | 24 image references dihapus, text branding/local APP_URL links, optional icon dihilangkan | Notifikasi tidak bergantung external branding CDN                     |
| CSP CDN image exemption                                                  | Removed; img-src self/data/blob                                                           | Tidak memperluas browser resource/security permissions                |
| README/footer metadata/fake default version                              | Standalone fork documentation; APP_VERSION unknown fallback; local VCS_REF header         | Development build bukan fake `vmain` atau fictitious semantic release |
| Historical Linux CDN/helper installers                                   | Early exit sebelum temp/download/service/credential handling                              | Tidak mengeksekusi opaque upstream helper/install path                |
| Historical uninstall help / Windows product URL                          | Local script usage / public fork URL                                                      | Bukan perubahan pada running installation                             |

Tiga guarded historical scripts:
`installers/linux-server/install.sh`,
`installers/linux-server/install_dev.sh`, dan
`installers/linux/AppDir/usr/share/pluton/install.sh`.
Remaining CDN constants/helper code dalam body **unreachable** dipertahankan
sebagai historical public packaging code; bukan supported execution/deployment.
Native guard tests memastikan early failure sebelum side effects. Jangan
menghapus guard untuk menjadikan workflow lama aktif. Installer agent yang
maintained, dengan pinning/checksums/atomic rollback/identity preservation,
tidak diganti dengan installer historical tersebut.

Yang secara sengaja dipertahankan:

- `LICENSE`, Apache-2.0 upstream attribution, package namespaces/authors,
  copyright/history, dan Restic/Rclone/third-party acknowledgements.
- Existing dormant `LICENSE_KEY`/credential compatibility dan extension hook
  identifiers: tidak mengaktifkan commercial network/license validation, tidak
  memaksa migration atau keyring deletion.
- Public upstream GitHub identity untuk attribution/history; technical third-party
  documentation dan official pinned dependency distribution URLs bukan product
  marketing.
- Rclone provider naming seperti Premiumize adalah third-party provider, bukan
  Pluton paid-edition gate.
- Existing community notifications tetap compatibility path. Tidak dimigrasi
  diam-diam ke Phase 7, dan tidak membuat duplicate subscriptions otomatis.
- Tidak ada tracked standalone NOTICE yang ditemukan; tidak ada LICENSE/NOTICE
  yang dihapus. Release redistribution tetap harus meninjau notices dependency.

Tidak menggunakan, menyalin, reverse-engineer atau menjalankan proprietary
PRO/Business source/binaries. Artikel baru tidak menyalin teks documentation
upstream. Product name tetap **Pluton**; tidak ada implied upstream endorsement.

Version/update behavior: footer membaca valid local APP_VERSION dan optional
sanitized VCS_REF (diteruskan Dockerfile.source dan X-App-Revision). Tanpa valid
release metadata muncul Development build. No trusted update feed berarti tidak
ada automatic update promise; immutable image/pinned agent updates tetap
operator-managed. Existing PWA reload notification hanya menyegarkan assets dari
instance yang sama, bukan update upstream product.

## C. Documentation portal architecture

- **Route**: lazy React `/docs/*` berada di luar authenticated app layout.
  Artikel statis boleh dibaca sebelum login; tidak memanggil settings/inventory
  APIs atau menerima decrypted data. Registered API authentication tetap di
  depan existing SPA fallback.
- **Format**: 77 original Bahasa Indonesia Markdown files di
  `frontend/src/docs/articles`; ordered typed manifest dengan title/slug/category,
  support badge dan evidence code paths.
- **Build**: Vite raw `import.meta.glob` membundel articles dalam lazy Docs chunk,
  existing frontend build menyalin hasilnya ke backend/public. Tidak perlu docs
  server, Docusaurus, CDN, Internet search atau external content fetch.
  `.dockerignore` lama membuang seluruh Markdown dan tests: ditambahkan allowlist
  khusus artikel serta dua docs/identity test files. Dockerfile.source menyalin
  public source evidence yang diperlukan validator (agent, ROADMAP, Compose
  definition, Dockerfile.source, installer, LICENSE) ke builder, bukan credential/deployment overrides.
  LICENSE juga disertakan dalam final source-built image.
- **Navigation**: home/category cards, expandable hierarchical sidebar,
  breadcrumbs, in-page TOC, stable heading anchors, previous/next, local footer,
  mobile Menu, skip link dan focus styles.
- **Search**: bounded local index title/headings/article text; query <=120
  characters, maksimal 25 hasil. Tidak mengirim query/inventory ke layanan lain.
- **Markdown**: existing Marked hanya digunakan sebagai lexer. React constructs
  elements, raw HTML tampil sebagai escaped text. Tidak ada
  `dangerouslySetInnerHTML`, arbitrary scripts atau executable user HTML.
- **URLs**: reject javascript/data/file/protocol-relative/control/backslash dan
  credential-bearing URLs; article links lokal dan reviewed technical HTTPS
  links. Screenshots hanya static `/docs-assets/...png/jpeg/webp`, bukan remote
  image requests. Internal route/anchor validation masuk tests.
- **Code**: monospace selectable blocks dengan copy button/ARIA status. Clipboard
  API saat tersedia, bounded textarea copy fallback untuk supported HTTP LAN;
  failure tidak mem-blank-kan page.
- **Diagrams**: original text workflow diagram; tidak ada Mermaid/executable HTML
  engine atau syntax-highlighting dependency baru.
- **Theme**: existing canonical Light/Dark tokens. Browser QA menemukan white
  on-accent token tidak cocok untuk Light docs headings; diperbaiki ke
  content-text-color dan ditambah regression assertion.
- **Refresh/not-found**: existing backend SPA catchall menyediakan bundle pada
  nested URL/direct refresh. Unknown docs path menampilkan useful article-not-
  found page, bukan blank app (SPA response HTTP 200; client not-found UX).
- **Validation**: `pnpm test:docs`; frontend build menjalankannya sebelum tsc/Vite.
  Checks article/category inventory, source evidence, sidebar routes, internal
  links/anchors, safe examples, search, actual renderer/navigation dan theme.
  Dalam Git checkout, artikel juga diperiksa tidak terabaikan oleh ignore rules.
  Pola `credentials.*` sebelumnya ikut mengabaikan artikel publik
  `security/credentials.md`; pengecualian `.gitignore` hanya untuk file artikel
  yang sudah disanitasi itu. Credential/configuration files asli tetap di-ignore.

Portal usable tanpa Internet jika Pluton server dan built assets reachable.
PWA precache existing mencakup docs bundle, tetapi bukan klaim seluruh application
API bisa beroperasi tanpa server atau bahwa service worker aktif di HTTP LAN.

Final bundle: Docs JS sekitar 177.89 kB (59.58 kB gzip), Docs CSS 4.70 kB.
Marked lexer terpisah sekitar 94.50 kB (31.51 kB gzip). Main application chunk
masih sekitar 1.07 MB; warning ini tidak disembunyikan dan unrelated large-scale
bundler refactor tidak dimasukkan.

## D. Documentation inventory

**77 artikel / 15 kategori**. Semua route berikut berasal dari manifest yang
diuji, bukan placeholder. `/docs` adalah home tambahan. Coverage label membedakan
implemented code, required operator setup dan unvalidated capability. Features
di dalam artikel tetap mengikuti guardrails/limitations yang dijelaskan, bukan
semua feature dinyatakan production-accepted.

### Mulai menggunakan — 5 artikel

| Artikel                                                                                   | Route aplikasi                       | Status cakupan            |
| ----------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------- |
| [Mengenal Pluton mandiri](../frontend/src/docs/articles/getting-started.md)               | `/docs/getting-started`              | Diimplementasikan         |
| [Persyaratan sistem](../frontend/src/docs/articles/getting-started/requirements.md)       | `/docs/getting-started/requirements` | Diimplementasikan         |
| [Quick Start](../frontend/src/docs/articles/getting-started/quick-start.md)               | `/docs/getting-started/quick-start`  | Setup operator diperlukan |
| [Administrator dan Dashboard](../frontend/src/docs/articles/getting-started/dashboard.md) | `/docs/getting-started/dashboard`    | Diimplementasikan         |
| [Istilah penting](../frontend/src/docs/articles/getting-started/terms.md)                 | `/docs/getting-started/terms`        | Diimplementasikan         |

### Instalasi dan deployment — 7 artikel

| Artikel                                                                                             | Route aplikasi                   | Status cakupan            |
| --------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------- |
| [Model deployment](../frontend/src/docs/articles/deployment.md)                                     | `/docs/deployment`               | Setup operator diperlukan |
| [Docker dan source-built image](../frontend/src/docs/articles/deployment/docker.md)                 | `/docs/deployment/docker`        | Setup operator diperlukan |
| [Docker Compose dan environment](../frontend/src/docs/articles/deployment/configuration.md)         | `/docs/deployment/configuration` | Setup operator diperlukan |
| [Volume, SQLite, dan configuration backup](../frontend/src/docs/articles/deployment/persistence.md) | `/docs/deployment/persistence`   | Diimplementasikan         |
| [Release dan pembaruan aman](../frontend/src/docs/articles/deployment/updates.md)                   | `/docs/deployment/updates`       | Diimplementasikan         |
| [Prosedur rollback](../frontend/src/docs/articles/deployment/rollback.md)                           | `/docs/deployment/rollback`      | Diimplementasikan         |
| [VM, Proxmox, healthcheck, dan log](../frontend/src/docs/articles/deployment/vm-logs.md)            | `/docs/deployment/vm-logs`       | Diimplementasikan         |

### Arsitektur dan workflow — 3 artikel

| Artikel                                                                                   | Route aplikasi                | Status cakupan    |
| ----------------------------------------------------------------------------------------- | ----------------------------- | ----------------- |
| [Komponen arsitektur](../frontend/src/docs/articles/architecture.md)                      | `/docs/architecture`          | Diimplementasikan |
| [Workflow backup hingga recovery](../frontend/src/docs/articles/architecture/workflow.md) | `/docs/architecture/workflow` | Diimplementasikan |
| [Status, kegagalan, dan retry](../frontend/src/docs/articles/architecture/states.md)      | `/docs/architecture/states`   | Diimplementasikan |

### Storage dan repository — 4 artikel

| Artikel                                                                               | Route aplikasi           | Status cakupan               |
| ------------------------------------------------------------------------------------- | ------------------------ | ---------------------------- |
| [Memilih storage](../frontend/src/docs/articles/storage.md)                           | `/docs/storage`          | Diimplementasikan            |
| [SFTP dan pemetaan path](../frontend/src/docs/articles/storage/sftp.md)               | `/docs/storage/sftp`     | Setup operator diperlukan    |
| [S3-compatible dan storage lokal](../frontend/src/docs/articles/storage/s3.md)        | `/docs/storage/s3`       | Belum divalidasi operasional |
| [Isolasi repository dan kapasitas](../frontend/src/docs/articles/storage/security.md) | `/docs/storage/security` | Diimplementasikan            |

### Backup Plan dan statistik — 5 artikel

| Artikel                                                                                             | Route aplikasi                          | Status cakupan    |
| --------------------------------------------------------------------------------------------------- | --------------------------------------- | ----------------- |
| [Membuat Backup Plan](../frontend/src/docs/articles/backup-plans.md)                                | `/docs/backup-plans`                    | Diimplementasikan |
| [Schedule, Retention, dan retry](../frontend/src/docs/articles/backup-plans/schedule-retention.md)  | `/docs/backup-plans/schedule-retention` | Diimplementasikan |
| [Advanced settings dan batas remote](../frontend/src/docs/articles/backup-plans/advanced.md)        | `/docs/backup-plans/advanced`           | Diimplementasikan |
| [Backup Now dan Backup History](../frontend/src/docs/articles/backup-plans/history.md)              | `/docs/backup-plans/history`            | Diimplementasikan |
| [Incremental, parent, dan deduplication](../frontend/src/docs/articles/backup-plans/incremental.md) | `/docs/backup-plans/incremental`        | Diimplementasikan |

### Remote Machine dan Agent — 5 artikel

| Artikel                                                                                             | Route aplikasi                       | Status cakupan            |
| --------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------- |
| [Outbound-only Remote Agent](../frontend/src/docs/articles/remote-agent.md)                         | `/docs/remote-agent`                 | Diimplementasikan         |
| [Enrollment dan instalasi](../frontend/src/docs/articles/remote-agent/enrollment.md)                | `/docs/remote-agent/enrollment`      | Setup operator diperlukan |
| [Allowed roots, symlink, dan preflight](../frontend/src/docs/articles/remote-agent/permissions.md)  | `/docs/remote-agent/permissions`     | Diimplementasikan         |
| [Pembaruan dan identity preservation](../frontend/src/docs/articles/remote-agent/updates.md)        | `/docs/remote-agent/updates`         | Diimplementasikan         |
| [OFFLINE, inventory, dan pencabutan](../frontend/src/docs/articles/remote-agent/troubleshooting.md) | `/docs/remote-agent/troubleshooting` | Diimplementasikan         |

### Database Lifecycle dan Hooks — 6 artikel

| Artikel                                                                                                | Route aplikasi                       | Status cakupan            |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------ | ------------------------- |
| [Filesystem dan database dalam satu snapshot](../frontend/src/docs/articles/database-backup.md)        | `/docs/database-backup`              | Diimplementasikan         |
| [MariaDB, MySQL, dan PostgreSQL](../frontend/src/docs/articles/database-backup/engines.md)             | `/docs/database-backup/engines`      | Setup operator diperlukan |
| [Koneksi, TLS, dan credential](../frontend/src/docs/articles/database-backup/connections.md)           | `/docs/database-backup/connections`  | Diimplementasikan         |
| [Privilege, Events, timeout, dan limit](../frontend/src/docs/articles/database-backup/dump-options.md) | `/docs/database-backup/dump-options` | Diimplementasikan         |
| [Pre/Post Backup Hooks](../frontend/src/docs/articles/database-backup/hooks.md)                        | `/docs/database-backup/hooks`        | Setup operator diperlukan |
| [SQL artifact dan konsistensi](../frontend/src/docs/articles/database-backup/artifacts.md)             | `/docs/database-backup/artifacts`    | Diimplementasikan         |

### Browse, Download, dan Restore — 4 artikel

| Artikel                                                                                  | Route aplikasi            | Status cakupan    |
| ---------------------------------------------------------------------------------------- | ------------------------- | ----------------- |
| [Memilih exact snapshot](../frontend/src/docs/articles/restore.md)                       | `/docs/restore`           | Diimplementasikan |
| [Snapshot Browser dan TAR Download](../frontend/src/docs/articles/restore/browse.md)     | `/docs/restore/browse`    | Diimplementasikan |
| [Select All, file, dan directory](../frontend/src/docs/articles/restore/selection.md)    | `/docs/restore/selection` | Diimplementasikan |
| [Staged Restore dan verifikasi manual](../frontend/src/docs/articles/restore/staging.md) | `/docs/restore/staging`   | Diimplementasikan |

### Automated Recovery Testing — 4 artikel

| Artikel                                                                                              | Route aplikasi                      | Status cakupan            |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------- |
| [Backup Complete bukan Recovery Passed](../frontend/src/docs/articles/recovery-testing.md)           | `/docs/recovery-testing`            | Diimplementasikan         |
| [Validasi filesystem dan SQL artifact](../frontend/src/docs/articles/recovery-testing/validation.md) | `/docs/recovery-testing/validation` | Diimplementasikan         |
| [Import ke target recovery-only](../frontend/src/docs/articles/recovery-testing/import.md)           | `/docs/recovery-testing/import`     | Setup operator diperlukan |
| [Passed, warning, Failed, dan cleanup](../frontend/src/docs/articles/recovery-testing/results.md)    | `/docs/recovery-testing/results`    | Diimplementasikan         |

### Legacy Repository Adapter — 4 artikel

| Artikel                                                                                               | Route aplikasi                           | Status cakupan    |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------- | ----------------- |
| [Kontrak repository read-only](../frontend/src/docs/articles/legacy-repositories.md)                  | `/docs/legacy-repositories`              | Diimplementasikan |
| [Registrasi dan snapshot historis](../frontend/src/docs/articles/legacy-repositories/registration.md) | `/docs/legacy-repositories/registration` | Diimplementasikan |
| [Browse dan staging legacy](../frontend/src/docs/articles/legacy-repositories/restore.md)             | `/docs/legacy-repositories/restore`      | Diimplementasikan |
| [Migrasi parallel tanpa mutasi](../frontend/src/docs/articles/legacy-repositories/migration.md)       | `/docs/legacy-repositories/migration`    | Diimplementasikan |

### Webhook dan Email — 5 artikel

| Artikel                                                                                           | Route aplikasi                      | Status cakupan            |
| ------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------- |
| [Notifikasi dan durable outbox](../frontend/src/docs/articles/notifications.md)                   | `/docs/notifications`               | Diimplementasikan         |
| [Webhook, JSON, dan HMAC](../frontend/src/docs/articles/notifications/webhook.md)                 | `/docs/notifications/webhook`       | Setup operator diperlukan |
| [SMTP relay dan TLS](../frontend/src/docs/articles/notifications/smtp.md)                         | `/docs/notifications/smtp`          | Setup operator diperlukan |
| [Subscriptions global dan per-plan](../frontend/src/docs/articles/notifications/subscriptions.md) | `/docs/notifications/subscriptions` | Diimplementasikan         |
| [Delivery History dan retry](../frontend/src/docs/articles/notifications/history.md)              | `/docs/notifications/history`       | Diimplementasikan         |

### Keamanan — 4 artikel

| Artikel                                                                                           | Route aplikasi               | Status cakupan            |
| ------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------- |
| [Trust boundaries dan least privilege](../frontend/src/docs/articles/security.md)                 | `/docs/security`             | Diimplementasikan         |
| [HTTP LAN menuju HTTPS](../frontend/src/docs/articles/security/https.md)                          | `/docs/security/https`       | Setup operator diperlukan |
| [SECRET, ENCRYPTION_KEY, dan rotasi](../frontend/src/docs/articles/security/credentials.md)       | `/docs/security/credentials` | Diimplementasikan         |
| [Isolasi source, staging, DB, dan endpoint](../frontend/src/docs/articles/security/boundaries.md) | `/docs/security/boundaries`  | Diimplementasikan         |

### Operasi dan pemeliharaan — 4 artikel

| Artikel                                                                                       | Route aplikasi                       | Status cakupan            |
| --------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------- |
| [Workflow operator harian](../frontend/src/docs/articles/operations.md)                       | `/docs/operations`                   | Diimplementasikan         |
| [Memantau backup, storage, dan agent](../frontend/src/docs/articles/operations/monitoring.md) | `/docs/operations/monitoring`        | Diimplementasikan         |
| [Disaster recovery runbook](../frontend/src/docs/articles/operations/disaster-recovery.md)    | `/docs/operations/disaster-recovery` | Setup operator diperlukan |
| [Checklist cutover dari SYS MON](../frontend/src/docs/articles/operations/cutover.md)         | `/docs/operations/cutover`           | Setup operator diperlukan |

### Troubleshooting — 7 artikel

| Artikel                                                                                                 | Route aplikasi                        | Status cakupan    |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------- | ----------------- |
| [Diagnostik yang aman](../frontend/src/docs/articles/troubleshooting.md)                                | `/docs/troubleshooting`               | Diimplementasikan |
| [Source tidak terbaca atau symlink ditolak](../frontend/src/docs/articles/troubleshooting/source.md)    | `/docs/troubleshooting/source`        | Diimplementasikan |
| [Login berhasil tetapi dump gagal](../frontend/src/docs/articles/troubleshooting/database.md)           | `/docs/troubleshooting/database`      | Diimplementasikan |
| [New Files berulang dan progress](../frontend/src/docs/articles/troubleshooting/incremental.md)         | `/docs/troubleshooting/incremental`   | Diimplementasikan |
| [SFTP path, permission, dan transport](../frontend/src/docs/articles/troubleshooting/sftp.md)           | `/docs/troubleshooting/sftp`          | Diimplementasikan |
| [Selection dan Recovery warning](../frontend/src/docs/articles/troubleshooting/recovery.md)             | `/docs/troubleshooting/recovery`      | Diimplementasikan |
| [Webhook, SMTP, dan konektivitas HTTPS](../frontend/src/docs/articles/troubleshooting/notifications.md) | `/docs/troubleshooting/notifications` | Diimplementasikan |

### Referensi — 10 artikel

| Artikel                                                                                               | Route aplikasi                     | Status cakupan    |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------- | ----------------- |
| [Cakupan dan tingkat dukungan](../frontend/src/docs/articles/reference.md)                            | `/docs/reference`                  | Diimplementasikan |
| [Referensi konfigurasi](../frontend/src/docs/articles/reference/configuration.md)                     | `/docs/reference/configuration`    | Diimplementasikan |
| [Referensi API operasional](../frontend/src/docs/articles/reference/api.md)                           | `/docs/reference/api`              | Diimplementasikan |
| [Status dan safe error codes](../frontend/src/docs/articles/reference/status-codes.md)                | `/docs/reference/status-codes`     | Diimplementasikan |
| [Identifikasi versi dan build](../frontend/src/docs/articles/reference/version.md)                    | `/docs/reference/version`          | Diimplementasikan |
| [Batasan yang diketahui](../frontend/src/docs/articles/reference/limitations.md)                      | `/docs/reference/limitations`      | Diimplementasikan |
| [FAQ operator](../frontend/src/docs/articles/reference/faq.md)                                        | `/docs/reference/faq`              | Diimplementasikan |
| [About dan Open Source Acknowledgements](../frontend/src/docs/articles/reference/acknowledgements.md) | `/docs/reference/acknowledgements` | Diimplementasikan |
| [Memelihara dokumentasi](../frontend/src/docs/articles/reference/contributing.md)                     | `/docs/reference/contributing`     | Diimplementasikan |
| [Changelog fork yang terverifikasi](../frontend/src/docs/articles/changelog.md)                       | `/docs/changelog`                  | Diimplementasikan |

### Cakupan dan unsupported behavior

Panduan mencakup deployment Compose/VM/SQLite/config backup, exact snapshot,
source permissions/symlinks, 0..8 DB entries (server-generated stable IDs),
engine/TLS/privilege diagnostics, constrained Pre/Post Hooks, filesystem vs SQL
consistency, TAR download, file/directory selection, staged never-overwrite
restore, artifact-only vs Required DB import, read-only Legacy adoption, safe
parallel cutover, notifications/HMAC/dedup/retry/SSRF, HTTP LAN menuju verified
HTTPS, secrets, capacity monitoring, safe updates/rollback, troubleshooting,
API/config/status references, version/FAQ/acknowledgements dan docs contribution.

Tidak didukung atau tidak diklaim:
restore-to-original/overwrite, production auto-import, Legacy repository mutation,
arbitrary remote shell/Rclone options, automatic unsigned updater, arbitrary
preview/paid activation, filesystem application quiescence otomatis, dedup ratio
dari file counts, physical capacity dari snapshot size, atau exactly-once
external notifications.

Actual MariaDB/PostgreSQL native clients diuji. MySQL compatibility path/unit
tests dipertahankan, tetapi genuine MySQL server native run tidak dilakukan pada
fixture ini. S3-compatible/local/general provider documentation menjelaskan batas
dukungan; current remote managed lifecycle tetap SFTP-only. Alternate providers
belum mendapatkan live acceptance dari task ini.

## E. Changed files dan compatibility

Total **151 files** dalam working-tree change set, termasuk report ini.
77 adalah artikel Markdown baru. Satu code stylesheet advertising dihapus
(`frontend/src/components/Upgrade/Upgrade.module.scss`); tidak ada backup,
snapshot, credentials, configuration atau production data yang dihapus.
Generated dist/public/test workspace files tidak dimasukkan ke Git.

```text
.dockerignore
.gitignore
Dockerfile
Dockerfile.source
agent/src/backupFilesystem.ts
agent/src/resticParent.test.ts
agent/src/resticParent.ts
agent/src/runtime.ts
agent/test-fixtures/phase5/restic.mjs
agent/test-fixtures/product-hardening.Dockerfile
backend/README.md
backend/__tests__/integration/phase5Database.smoke.ts
backend/__tests__/integration/resticIncremental.smoke.ts
backend/__tests__/managers/BaseSystemManager.test.ts
backend/__tests__/middlewares/versionMiddleware.test.ts
backend/__tests__/notifications/ProductReferences.test.ts
backend/__tests__/services/SettingsService.test.ts
backend/__tests__/utils/spaFallback.test.ts
backend/src/createApp.ts
backend/src/managers/BaseSystemManager.ts
backend/src/middlewares/versionMiddleware.ts
backend/src/notifications/BackupNotification.ts
backend/src/notifications/templates/email/backup/BackupFailedNotification.ejs
backend/src/notifications/templates/email/backup/BackupStartedNotification.ejs
backend/src/notifications/templates/email/backup/BackupSuccessNotification.ejs
backend/src/notifications/templates/email/backup/ReplicationFailedNotification.ejs
backend/src/notifications/templates/email/backup/SelfBackupFailedNotification.ejs
backend/src/notifications/templates/email/email.html
backend/src/services/SettingsService.ts
backend/src/utils/spaFallback.ts
docs/ARCHITECTURE.md
docs/SELFHOSTED_PRODUCT_HARDENING_REPORT.md
frontend/README.md
frontend/__tests__/backupStatistics.test.ts
frontend/__tests__/docs.test.ts
frontend/__tests__/productIdentity.test.ts
frontend/__tests__/themeChart.test.ts
frontend/package.json
frontend/src/components/App/Footer/Footer.tsx
frontend/src/components/App/SideNav/SideNav.tsx
frontend/src/components/Plan/BackupEvents/BackupEvents.module.scss
frontend/src/components/Plan/BackupEvents/BackupEvents.tsx
frontend/src/components/Plan/BackupEvents/BackupStatistics.tsx
frontend/src/components/Plan/Backups/Backups.tsx
frontend/src/components/Plan/PlanBackups/PlanBackups.tsx
frontend/src/components/Plan/PlanItems/PlanItem.tsx
frontend/src/components/Plan/PlanSizeChart/PlanSizeChart.tsx
frontend/src/components/Plan/PlanStats/PlanStats.tsx
frontend/src/components/Plan/SnapshotViewer/SnapshotViewer.tsx
frontend/src/components/Plan/SnapshotViewer/SnapshotViewerFile.tsx
frontend/src/components/Upgrade/Upgrade.module.scss
frontend/src/components/Upgrade/Upgrade.tsx
frontend/src/components/common/form/StorageProviderSelect/StorageProviderSelect.tsx
frontend/src/config/features.ts
frontend/src/docs/Docs.module.scss
frontend/src/docs/Docs.tsx
frontend/src/docs/Markdown.tsx
frontend/src/docs/articles/architecture.md
frontend/src/docs/articles/architecture/states.md
frontend/src/docs/articles/architecture/workflow.md
frontend/src/docs/articles/backup-plans.md
frontend/src/docs/articles/backup-plans/advanced.md
frontend/src/docs/articles/backup-plans/history.md
frontend/src/docs/articles/backup-plans/incremental.md
frontend/src/docs/articles/backup-plans/schedule-retention.md
frontend/src/docs/articles/changelog.md
frontend/src/docs/articles/database-backup.md
frontend/src/docs/articles/database-backup/artifacts.md
frontend/src/docs/articles/database-backup/connections.md
frontend/src/docs/articles/database-backup/dump-options.md
frontend/src/docs/articles/database-backup/engines.md
frontend/src/docs/articles/database-backup/hooks.md
frontend/src/docs/articles/deployment.md
frontend/src/docs/articles/deployment/configuration.md
frontend/src/docs/articles/deployment/docker.md
frontend/src/docs/articles/deployment/persistence.md
frontend/src/docs/articles/deployment/rollback.md
frontend/src/docs/articles/deployment/updates.md
frontend/src/docs/articles/deployment/vm-logs.md
frontend/src/docs/articles/getting-started.md
frontend/src/docs/articles/getting-started/dashboard.md
frontend/src/docs/articles/getting-started/quick-start.md
frontend/src/docs/articles/getting-started/requirements.md
frontend/src/docs/articles/getting-started/terms.md
frontend/src/docs/articles/legacy-repositories.md
frontend/src/docs/articles/legacy-repositories/migration.md
frontend/src/docs/articles/legacy-repositories/registration.md
frontend/src/docs/articles/legacy-repositories/restore.md
frontend/src/docs/articles/notifications.md
frontend/src/docs/articles/notifications/history.md
frontend/src/docs/articles/notifications/smtp.md
frontend/src/docs/articles/notifications/subscriptions.md
frontend/src/docs/articles/notifications/webhook.md
frontend/src/docs/articles/operations.md
frontend/src/docs/articles/operations/cutover.md
frontend/src/docs/articles/operations/disaster-recovery.md
frontend/src/docs/articles/operations/monitoring.md
frontend/src/docs/articles/recovery-testing.md
frontend/src/docs/articles/recovery-testing/import.md
frontend/src/docs/articles/recovery-testing/results.md
frontend/src/docs/articles/recovery-testing/validation.md
frontend/src/docs/articles/reference.md
frontend/src/docs/articles/reference/acknowledgements.md
frontend/src/docs/articles/reference/api.md
frontend/src/docs/articles/reference/configuration.md
frontend/src/docs/articles/reference/contributing.md
frontend/src/docs/articles/reference/faq.md
frontend/src/docs/articles/reference/limitations.md
frontend/src/docs/articles/reference/status-codes.md
frontend/src/docs/articles/reference/version.md
frontend/src/docs/articles/remote-agent.md
frontend/src/docs/articles/remote-agent/enrollment.md
frontend/src/docs/articles/remote-agent/permissions.md
frontend/src/docs/articles/remote-agent/troubleshooting.md
frontend/src/docs/articles/remote-agent/updates.md
frontend/src/docs/articles/restore.md
frontend/src/docs/articles/restore/browse.md
frontend/src/docs/articles/restore/selection.md
frontend/src/docs/articles/restore/staging.md
frontend/src/docs/articles/security.md
frontend/src/docs/articles/security/boundaries.md
frontend/src/docs/articles/security/credentials.md
frontend/src/docs/articles/security/https.md
frontend/src/docs/articles/storage.md
frontend/src/docs/articles/storage/s3.md
frontend/src/docs/articles/storage/security.md
frontend/src/docs/articles/storage/sftp.md
frontend/src/docs/articles/troubleshooting.md
frontend/src/docs/articles/troubleshooting/database.md
frontend/src/docs/articles/troubleshooting/incremental.md
frontend/src/docs/articles/troubleshooting/notifications.md
frontend/src/docs/articles/troubleshooting/recovery.md
frontend/src/docs/articles/troubleshooting/sftp.md
frontend/src/docs/articles/troubleshooting/source.md
frontend/src/docs/content.ts
frontend/src/docs/manifest.ts
frontend/src/docs/model.ts
frontend/src/router.tsx
frontend/src/routes/Plans/Plans.tsx
frontend/src/services/users.ts
frontend/src/utils/backupStatistics.ts
frontend/src/utils/buildIdentity.ts
frontend/src/utils/helpers.ts
installers/linux-server/install.sh
installers/linux-server/install_dev.sh
installers/linux-server/uninstall.sh
installers/linux/AppDir/usr/share/pluton/install.sh
installers/windows/pluton-setup.iss
package.json
readme.md
scripts/validate-product-hardening.ps1
```

| Contract                                         | Perubahan                                                                                       |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Database/schema                                  | Tidak ada migration atau rewrite; Phase 7 baseline schema tetap                                 |
| Dependencies/lockfile                            | Tidak ada dependency baru, package versions atau lockfile changes; pnpm 10.20.0                 |
| Backup API/event protocol                        | Tidak ada breaking payload/result/event field change                                            |
| Agent identity/enrollment/HMAC/queue             | Preserved; no re-enrollment/rotation                                                            |
| Agent code                                       | Source/build revision update diperlukan untuk parent/replay fix; advertised version tetap 0.4.1 |
| Version metadata                                 | Optional X-App-Revision valid-hex header; old clients boleh mengabaikannya                      |
| Latest version endpoint                          | Compatibility route retained, now null/no external upstream lookup                              |
| Binary update endpoints                          | Existing response structure retained; safe unavailable/manual-update result                     |
| Docs                                             | New public static SPA route only; authenticated APIs unchanged                                  |
| Existing plans/storage/SQL credentials/snapshots | Reusable; tidak perlu recreate plan/storage/repository atau migrate data                        |
| Phase 5/6/7                                      | Lifecycle, exact-snapshot recovery and durable delivery boundaries retained                     |
| Legacy                                           | Read-only/no-lock/staging-only behavior untouched                                               |

Agent 0.4.1 inventory label saja **tidak membuktikan** parent fix sudah terpasang:
operator harus memastikan reviewed source/build revision. Old agent tetap dapat
berkomunikasi tetapi tidak mendapat optimasi baru. Existing snapshot paths/IDs,
SQL artifact filenames/server database IDs dan secrets tetap compatible.
Statistics history lama tidak dibetulkan retroactively.

## F. Tests dan hasil

Semua unit/integration fixtures memakai synthetic sources/credentials dan
disposable data. Native runners tidak menggunakan production accounts, volumes,
repositories, domains atau receiver. Tidak menjalankan application terhadap
real data. Message fixture seperti “Secrets updated in /data/keys.json” berasal
dari private disposable container tmpfs, bukan perubahan secret instance nyata.

| Check                                |     Passed |            Failed | Skipped | Result                                                                                                             |
| ------------------------------------ | ---------: | ----------------: | ------: | ------------------------------------------------------------------------------------------------------------------ |
| Complete frontend Node tests         |         82 |                 0 |       0 | Passed, termasuk actual React render/chart/docs dan Phase 4–7 regressions                                          |
| Docs + build identity subset         |         13 |                 0 |       0 | Passed; subset dari 82, bukan additional test total                                                                |
| Complete backend Windows             |       2964 |                 0 |       4 | 153/153 suites passed, 2968 test cases total                                                                       |
| Complete backend Linux               |       2962 |                 0 |       6 | 153/153 suites passed, same 2968 cases, isolated non-root fixture                                                  |
| Complete agent Linux                 |         96 |                 0 |       0 | Native process/permission boundary + synthetic child tools                                                         |
| Native Restic 0.19.1                 |   7 groups |                 0 |       0 | Actual backup/summary/parent/restore, bukan mocked counter expectations                                            |
| Historical installer guard tests     |          3 |                 0 |       0 | Disabled sebelum side effects; network disabled                                                                    |
| Native Phase 5/6                     |    8 modes |                 0 |       0 | Real SFTP/Restic/MariaDB/PostgreSQL lifecycle/recovery                                                             |
| Native Phase 7                       |   1 runner |                 0 |       0 | HTTP/HMAC/status/timeout, SMTP/auth/rejection, lifecycle/dedup/restart, verified/untrusted TLS                     |
| Existing release workflow regression |         12 |                 0 |       0 | Synthetic Release Please/fork publication fixtures; no real publication                                            |
| Backend/frontend/agent typecheck     | 3 commands |                 0 |       — | Passed                                                                                                             |
| Backend lint                         |  1 command |                 0 |       — | Passed                                                                                                             |
| Full production build                |    3 tasks |                 0 |       — | Frontend + agent + backend, docs copied to backend/public                                                          |
| Fresh source-built Docker image      |    1 build |                 0 |       — | Full Dockerfile.source build, including 13/13 docs checks inside Linux builder                                     |
| Source-image offline bundle check    |  1 fixture |                 0 |       0 | Non-root, local Docs bundle/credential article/LICENSE, unknown metadata, pinned executable tools; app not started |
| Changed-file Prettier check          |     Passed |                 0 |       — | Source/test/docs/SCSS/JSON/MJS/HTML                                                                                |
| git diff --check                     |     Passed |                 0 |       — | No whitespace errors                                                                                               |
| Frontend lint baseline               |          — | 1 command blocked |       — | Config load error, bukan source lint pass                                                                          |

Numbers antar-platform menguji banyak cases yang sama; jangan dijumlah menjadi
unique coverage. Counts group/mode tidak diubah menjadi invented assertion counts.

### Commands

```sh
pnpm --filter @plutonhq/core-backend test --maxWorkers=2 --silent --verbose=false
node --experimental-strip-types --test frontend/__tests__/*.test.ts
pnpm test:docs
pnpm test:release
pnpm --filter @plutonhq/core-backend exec tsc --noEmit
pnpm --filter @plutonhq/core-frontend exec tsc -b
pnpm --filter @plutonhq/pluton-agent typecheck
pnpm --filter @plutonhq/core-backend lint
pnpm --filter @plutonhq/core-frontend lint
pnpm build
git diff --check
```

Linux full backend uses cached `pluton-phase6-tests:local`, read-only mounted
source/tests/migrations/agent build, `--user node`, network none, private tmpfs
`/tmp` and `/data`, Jest maxWorkers=2. Agent uses cached disposable
`pluton-product-agent-tests:local`, non-root, network none and synthetic tools,
with final agent/dist mounted read-only.

```powershell
./scripts/validate-product-hardening.ps1
./scripts/validate-phase6.ps1 -Modes @(
  'single', 'two-mariadb', 'mixed',
  'phase6-filesystem', 'phase6-mariadb', 'phase6-postgresql',
  'phase6-mixed', 'phase6-mixed-failure'
)
./scripts/validate-phase7.ps1
```

Fresh local image validation:

```sh
docker build --file Dockerfile.source --tag pluton-product-hardening-build:local --build-arg APP_VERSION=unknown --build-arg VCS_REF=unknown .
```

Image hanya dibangun lokal, tidak dipublish/dideploy. Offline inspection memakai
network none, read-only root filesystem, disposable /data tmpfs, image user 10001,
dan Node entrypoint tanpa menjalankan application. Bundled docs termasuk artikel
security/credentials, LICENSE, unknown metadata, serta actual Restic 0.19.1 dan
Rclone 1.75.1 executables diverifikasi. Source image menggunakan pinned Node
24.16.0; tidak mengganti Node pada host/agent/production.

Attempt source-image pertama menemukan satu docs test failure: public evidence
`Dockerfile.source` belum ada di builder workspace. COPY build definition
ditambahkan, bukan menonaktifkan assertion; rerun 13/13 dan full image build
berhasil. Markdown/tests/source evidence lain juga dimasukkan melalui input
allowlist yang spesifik, tidak menyertakan environment secrets atau overrides.

Native images/tools available locally:

- `pluton-phase5-real-db:local`: Restic 0.19.1, Rclone 1.75.1,
  MariaDB 11.8.8 and PostgreSQL 18.6, actual SFTP and disposable databases.
- Native incremental run: first/unchanged/modified/added files, DB workspace
  mismatch/fix, metadata-only changes, host/path/plan/repository isolation,
  parent IDs, summary/packed counters and restore content assertions.
- Phase 5: single/two MariaDB and mixed DB backups, second backup verifies
  compatible parent and application unmodified counts; lost-receipt replay
  verifies actual original statistics without redumping.
- Phase 6: filesystem, MariaDB, PostgreSQL, mixed Required imports and injected
  mixed failure. Source databases stopped before recovery; exact snapshot,
  hashes, replay idempotency, unchanged repository and cleanup asserted.
  **mixed-failure expects Recovery Failed and successful cleanup**: test pass
  does not mean every recovery scenario returned Passed.
- Phase 7: dedicated temporary receivers/internal network/private CA only.
  Live receiver or mail inbox delivery acceptance is not implied.
- Historical guard harness uses cached Debian Node 20 image only because Bash
  is needed to execute old shell scripts; product Node runtime/pinning is not
  changed. Earlier harness failure from Alpine lacking Bash was repaired and
  full guard run passed.

Skips: existing platform/environment-specific fixture conditions, not weakened
new tests. The complete Linux agent suite has no skipped permission tests.

### Browser validation and existing warnings

Computer-use skill used only for the local built frontend preview, not production.
Actual browser checks: local search HMAC and article navigation, copy button,
heading anchor/deep-link reload, unknown article page, Light/Dark readability,
desktop viewport 1365×900 and mobile 390×844 Menu/reflow. No console error observed
in final docs session. Mobile page did not horizontally overflow; anchor remained
below sticky header. Preview stopped; temporary browser tab closed and viewport
override reset.

Baseline frontend lint: ESLint 10 / typescript-eslint rejects string
`extends: "eslint-config-prettier"` at config load. Config is unchanged in this
task. It is **not** reported as lint success.

Backend run can emit existing Pino process MaxListeners warnings; Windows Jest
also reports worker teardown/active timer warning despite exit 0 and all suites
passing. No blanket suppression/listener-limit increase was added. Production
build retains large-main-chunk and old Browserslist-data warnings. None are hidden
or promoted to “production fully validated.”

Standalone packaged executables/AppImage/Windows installers dan full application
startup/smoke terhadap production configuration belum accepted end-to-end.
Fresh source image build dan offline bundle/executable inspection sudah lolos;
application production build plus native fixtures bukan seluruh deployment matrix.

## G. Deployment and rollback guidance — operator actions, not executed

### Before any deployment

1. Review this working-tree diff and tests; authorize a reviewed immutable
   build/release separately. Nothing has been committed or published by this task.
2. Record exact old image digest and reviewed new revision/version. Do not
   silently pull mutable latest tags or use upstream commercial updater scripts.
3. Take a consistent control-plane backup of SQLite and full persistent volume
   with keys/config/schedules. Preserve **existing SECRET, ENCRYPTION_KEY,
   /data, repository passwords, stored DB credentials, agent identity and
   receipts**. Do not print/export secrets into reports or rotate them during
   deployment.
4. Coordinate maintenance when no managed backup/recovery/notification lease is
   running. Keep existing independent legacy backup jobs active until separate
   operational cutover approval.
5. Check current Phase 7 schema baseline. This task adds **no migration**; do not
   downgrade to a build predating Phase 5/6/7 schemas against the current DB.

### Safe rollout

Use the reviewed source-built image with exact immutable digest and preserved
volume/env. Existing startup checks should continue to fail closed on mismatched
keys; do not “fix” startup by regenerating secrets or deleting encrypted records.

Install the reviewed agent source revision on one approved test/canary host via
the maintained pinned installer, reusing existing identity and allowed roots.
**Do not use --re-enroll**, global system Node replacement, automatic chmod/chown/
setfacl, or source/repository writable permissions to make a validation pass.
Keep the previous known-working application/runtime for atomic rollback.

HTTP trusted-LAN pilot remains explicitly supported. HTTPS requires deliberate
reverse proxy/domain/certificate/DNS/firewall setup and matching agent origin;
migrate after validating certificates/session/proxy behavior. No TLS disabling or
forced automatic migration is added. Enable insecure HTTP only within the
existing explicit policy on both server and agent; it is not a production-security
recommendation.

### Post-deployment canary checklist

- Health/login, correct local version/revision, direct nested `/docs` refresh,
  search/copy/not-found, Light/Dark and mobile navigation.
- Existing sources remain ONLINE; storage/plan lists intact; encrypted saved DB
  credentials remain write-only in responses/UI.
- Filesystem canary twice: second unchanged files become unmodified using a
  compatible verified parent. Change/add one synthetic file and inspect actual
  counters.
- Filesystem+DB canary twice: application files unmodified; SQL legitimately
  changed as necessary; artifact path/hash and exact snapshot binding intact.
  Without an eligible receipt, first no-parent baseline is expected—not cause
  to recreate plan/storage/repository.
- Confirm Snapshot Size is logical, Data Added/Packed are added blobs, and
  Deleted/physical usage remain Not measured rather than false zero.
- Browse, streamed TAR Download, selected files/directories and never-overwrite
  staged Restore; compare synthetic hashes. Never restore to live source.
- Recovery artifact-only should explicitly say import NOT TESTED; Required import
  only to a provisioned recovery-only disposable target. Cleanup complete and
  backup status independent.
- Review sanitized outbox/history. Phase 7 live webhook/SMTP tests only after
  separately authorized receiver/relay setup; backup must not fail on delivery
  error.
- Check queue/reconnect/replay after restart and restored receipt/statistic
  continuity; review safe stage errors without raw credentials.

### Rollback

Quiesce jobs/leases, redeploy the recorded previous **Phase-7-compatible** immutable
image and previous agent application/runtime without replacing its identity/data.
Use the same SECRET/ENCRYPTION_KEY/volume. Existing snapshots, artifact layout and
plans require no conversion. If rollback predates compatible schemas, use a
coordinated control-plane restore instead of ad-hoc schema deletion/down-migration.

Old agent code may report repeated New Files again but does not need repository
rewrite; restored/read-only snapshot data stays valid. No forget/prune/unlock,
history rewriting, storage recreation or snapshot deletion is part of rollback.

## H. Remaining limitations, infrastructure work, and review readiness

- Parent fix is code/native-reproduction verified. No actual pilot metadata,
  repository usage or production outcome was inspected during this task.
- Candidate receipt bound/state loss or intentionally changed backup identity
  can re-baseline. Retained receipt history is not a permanent parent database.
- Historical completion statistics are not rewritten; old zero summaries remain
  historical records. Malformed/missing Restic replay summary fails safely.
- Physical repository capacity/dedup ratio requires separate actual measurement;
  no approximation from logical sizes is presented.
- Large datasets, network load/reconnect timing and source mutations still need
  canary observation; unit/native small fixtures are not full-scale production
  performance proof.
- Domain, reverse proxy, trusted CA/certificates, firewall, least-privilege DB
  grants, source read/traverse ACLs and recovery-only import targets remain
  deliberate manual infrastructure work.
- Credentials previously hardcoded in independent legacy scripts require a
  separately approved rotation inventory/procedure. Those scripts/servers were
  not inspected or modified here.
- Phase 7 real webhook/SMTP acceptance deliberately deferred. External delivery
  remains at-least-once; receiver event-ID deduplication is required.
- Alternate storage providers/genuine MySQL native/live acceptance, historical
  desktop packaging, offline-airgap image mirroring and TLS production rollout
  are not claimed validated.
- Frontend ESLint baseline and existing Jest teardown/listener/build warnings
  remain separately documented.
- Unsupported features are explained, not enabled by removing a commercial modal.
  No new roadmap phase, restore-to-original or unrelated feature was introduced.

**Ready for code review**, with the stated baseline/acceptance limitations.
Not authorization for production deployment or replacement of legacy backup jobs.
