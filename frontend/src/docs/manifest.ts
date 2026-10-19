export type Support = 'implemented' | 'operator-setup' | 'pilot' | 'unvalidated' | 'unsupported';
export type DocArticle = { slug: string; title: string; support: Support };
export type DocCategory = { id: string; title: string; evidence: string[]; articles: DocArticle[] };
const page = (slug: string, title: string, support: Support = 'implemented'): DocArticle => ({ slug, title, support });
export const supportLabels: Record<Support, string> = {
   implemented: 'Diimplementasikan',
   'operator-setup': 'Memerlukan setup operator',
   pilot: 'Validasi pilot terbatas',
   unvalidated: 'Belum divalidasi operasional',
   unsupported: 'Tidak didukung',
};
export const docCategories: DocCategory[] = [
   {
      id: 'getting-started',
      title: 'Mulai menggunakan',
      evidence: ['frontend/src/routes/Setup/Setup.tsx', 'frontend/src/routes/Plans/Plans.tsx'],
      articles: [
         page('getting-started', 'Mengenal Pluton mandiri'),
         page('getting-started/requirements', 'Persyaratan sistem'),
         page('getting-started/quick-start', 'Quick Start', 'operator-setup'),
         page('getting-started/dashboard', 'Administrator dan Dashboard'),
         page('getting-started/terms', 'Istilah penting'),
      ],
   },
   {
      id: 'deployment',
      title: 'Instalasi dan deployment',
      evidence: ['Dockerfile.source', 'deploy/compose.yml', 'backend/src/utils/cliSelfRestore.ts'],
      articles: [
         page('deployment', 'Model deployment', 'operator-setup'),
         page('deployment/docker', 'Docker dan source-built image', 'operator-setup'),
         page('deployment/configuration', 'Docker Compose dan environment', 'operator-setup'),
         page('deployment/persistence', 'Volume, SQLite, dan configuration backup'),
         page('deployment/updates', 'Release dan pembaruan aman'),
         page('deployment/rollback', 'Prosedur rollback'),
         page('deployment/vm-logs', 'VM, Proxmox, healthcheck, dan log'),
      ],
   },
   {
      id: 'architecture',
      title: 'Arsitektur dan workflow',
      evidence: ['backend/src/createApp.ts', 'agent/src/runtime.ts', 'backend/src/jobs/JobProcessor.ts'],
      articles: [
         page('architecture', 'Komponen arsitektur'),
         page('architecture/workflow', 'Workflow backup hingga recovery'),
         page('architecture/states', 'Status, kegagalan, dan retry'),
      ],
   },
   {
      id: 'storage',
      title: 'Storage dan repository',
      evidence: ['backend/src/utils/providers.ts', 'backend/src/services/RemoteBackupService.ts', 'agent/src/backupFilesystem.ts'],
      articles: [
         page('storage', 'Memilih storage'),
         page('storage/sftp', 'SFTP dan pemetaan path', 'operator-setup'),
         page('storage/s3', 'S3-compatible dan storage lokal', 'unvalidated'),
         page('storage/security', 'Isolasi repository dan kapasitas'),
      ],
   },
   {
      id: 'backup-plans',
      title: 'Backup Plan dan statistik',
      evidence: ['backend/src/services/PlanService.ts', 'backend/src/stores/PlanStore.ts', 'agent/src/resticParent.ts'],
      articles: [
         page('backup-plans', 'Membuat Backup Plan'),
         page('backup-plans/schedule-retention', 'Schedule, Retention, dan retry'),
         page('backup-plans/advanced', 'Advanced settings dan batas remote'),
         page('backup-plans/history', 'Backup Now dan Backup History'),
         page('backup-plans/incremental', 'Incremental, parent, dan deduplication'),
      ],
   },
   {
      id: 'remote-agent',
      title: 'Remote Machine dan Agent',
      evidence: ['installers/install-agent.sh', 'agent/src/identity.ts', 'agent/src/filesystemPolicy.ts'],
      articles: [
         page('remote-agent', 'Outbound-only Remote Agent'),
         page('remote-agent/enrollment', 'Enrollment dan instalasi', 'operator-setup'),
         page('remote-agent/permissions', 'Allowed roots, symlink, dan preflight'),
         page('remote-agent/updates', 'Pembaruan dan identity preservation'),
         page('remote-agent/troubleshooting', 'OFFLINE, inventory, dan pencabutan'),
      ],
   },
   {
      id: 'database-backup',
      title: 'Database Lifecycle dan Hooks',
      evidence: ['agent/src/backupLifecycle.ts', 'agent/src/lifecyclePolicy.ts', 'agent/src/lifecycleProcess.ts'],
      articles: [
         page('database-backup', 'Filesystem dan database dalam satu snapshot'),
         page('database-backup/engines', 'MariaDB, MySQL, dan PostgreSQL', 'operator-setup'),
         page('database-backup/connections', 'Koneksi, TLS, dan credential'),
         page('database-backup/dump-options', 'Privilege, Events, timeout, dan limit'),
         page('database-backup/hooks', 'Pre/Post Backup Hooks', 'operator-setup'),
         page('database-backup/artifacts', 'SQL artifact dan konsistensi'),
      ],
   },
   {
      id: 'restore',
      title: 'Browse, Download, dan Restore',
      evidence: ['backend/src/services/RemoteRepositoryRecoveryService.ts', 'frontend/src/utils/restoreSelection.ts'],
      articles: [
         page('restore', 'Memilih exact snapshot'),
         page('restore/browse', 'Snapshot Browser dan TAR Download'),
         page('restore/selection', 'Select All, file, dan directory'),
         page('restore/staging', 'Staged Restore dan verifikasi manual'),
      ],
   },
   {
      id: 'recovery-testing',
      title: 'Automated Recovery Testing',
      evidence: [
         'backend/src/services/RecoveryTestService.ts',
         'backend/src/utils/recoveryValidation.ts',
         'backend/src/utils/recoveryDatabaseImport.ts',
      ],
      articles: [
         page('recovery-testing', 'Backup Complete bukan Recovery Passed'),
         page('recovery-testing/validation', 'Validasi filesystem dan SQL artifact'),
         page('recovery-testing/import', 'Import ke target recovery-only', 'operator-setup'),
         page('recovery-testing/results', 'Passed, warning, Failed, dan cleanup'),
      ],
   },
   {
      id: 'legacy-repositories',
      title: 'Legacy Repository Adapter',
      evidence: ['backend/src/services/LegacyRepositoryService.ts', 'backend/src/utils/restic/LegacyRepositoryInspector.ts'],
      articles: [
         page('legacy-repositories', 'Kontrak repository read-only'),
         page('legacy-repositories/registration', 'Registrasi dan snapshot historis'),
         page('legacy-repositories/restore', 'Browse dan staging legacy'),
         page('legacy-repositories/migration', 'Migrasi parallel tanpa mutasi'),
      ],
   },
   {
      id: 'notifications',
      title: 'Webhook dan Email',
      evidence: [
         'backend/src/notifications/NotificationDeliveryManager.ts',
         'backend/src/notifications/outboundDelivery.ts',
         'backend/src/notifications/terminalPayload.ts',
      ],
      articles: [
         page('notifications', 'Notifikasi dan durable outbox'),
         page('notifications/webhook', 'Webhook, JSON, dan HMAC', 'operator-setup'),
         page('notifications/smtp', 'SMTP relay dan TLS', 'operator-setup'),
         page('notifications/subscriptions', 'Subscriptions global dan per-plan'),
         page('notifications/history', 'Delivery History dan retry'),
      ],
   },
   {
      id: 'security',
      title: 'Keamanan',
      evidence: [
         'backend/src/services/CredentialManager.ts',
         'backend/src/middlewares/authMiddleware.ts',
         'backend/src/notifications/deliveryPolicy.ts',
      ],
      articles: [
         page('security', 'Trust boundaries dan least privilege'),
         page('security/https', 'HTTP LAN menuju HTTPS', 'operator-setup'),
         page('security/credentials', 'SECRET, ENCRYPTION_KEY, dan rotasi'),
         page('security/boundaries', 'Isolasi source, staging, DB, dan endpoint'),
      ],
   },
   {
      id: 'operations',
      title: 'Operasi dan pemeliharaan',
      evidence: ['backend/src/services/StartupRecovery.ts', 'backend/src/services/SelfBackupService.ts', 'backend/src/routes/health.ts'],
      articles: [
         page('operations', 'Workflow operator harian'),
         page('operations/monitoring', 'Memantau backup, storage, dan agent'),
         page('operations/disaster-recovery', 'Disaster recovery runbook', 'operator-setup'),
         page('operations/cutover', 'Checklist cutover dari SYS MON', 'operator-setup'),
      ],
   },
   {
      id: 'troubleshooting',
      title: 'Troubleshooting',
      evidence: ['backend/src/utils/remoteBackupDiagnostics.ts', 'agent/src/lifecycleProcess.ts', 'agent/src/backupFilesystem.ts'],
      articles: [
         page('troubleshooting', 'Diagnostik yang aman'),
         page('troubleshooting/source', 'Source tidak terbaca atau symlink ditolak'),
         page('troubleshooting/database', 'Login berhasil tetapi dump gagal'),
         page('troubleshooting/incremental', 'New Files berulang dan progress'),
         page('troubleshooting/sftp', 'SFTP path, permission, dan transport'),
         page('troubleshooting/recovery', 'Selection dan Recovery warning'),
         page('troubleshooting/notifications', 'Webhook, SMTP, dan konektivitas HTTPS'),
      ],
   },
   {
      id: 'reference',
      title: 'Referensi',
      evidence: ['backend/src/services/ConfigService.ts', 'docs/ROADMAP.md', 'LICENSE'],
      articles: [
         page('reference', 'Cakupan dan tingkat dukungan'),
         page('reference/configuration', 'Referensi konfigurasi'),
         page('reference/api', 'Referensi API operasional'),
         page('reference/status-codes', 'Status dan safe error codes'),
         page('reference/version', 'Identifikasi versi dan build'),
         page('reference/limitations', 'Batasan yang diketahui'),
         page('reference/faq', 'FAQ operator'),
         page('reference/acknowledgements', 'About dan Open Source Acknowledgements'),
         page('reference/contributing', 'Memelihara dokumentasi'),
         page('changelog', 'Changelog fork yang terverifikasi'),
      ],
   },
];
export const docArticles = docCategories.flatMap((category) =>
   category.articles.map((article) => ({ ...article, categoryId: category.id, categoryTitle: category.title })),
);
