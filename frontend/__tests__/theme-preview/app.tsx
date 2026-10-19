// Actual routes/components and actual ThemeProvider. No pilot data, live API,
// stored credentials, or filesystem operations are used by this preview.
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Link, useNavigate } from 'react-router';
import { parseBackupHistoryQuery } from '../../../backend/src/utils/backupHistoryQuery';
import { AppRoutes } from '../../src/router';
import { ThemeProvider, useTheme } from '../../src/context/ThemeContext';
import { DEFAULT_PLAN_SETTINGS } from '../../src/utils/constants';
import sftpFields from '../../../backend/src/utils/providers/sftp';
import '../../src/styles/global.scss';

const now = Date.now();
// Synthetic API responses only. Production pagination is separately tested
// against real migrated SQLite, never this in-memory UI fixture.
const backups = Array.from({ length: 237 }, (_, index) => ({
   id: `example-${String(237 - index).padStart(4, '0')}`,
   title: `Example backup ${index + 1}`,
   snapshotId: (237 - index).toString(16).padStart(64, '0'),
   started: now - (index + 1) * 6 * 3600000,
   ended: now - (index + 1) * 6 * 3600000 + 44000,
   duration: 44,
   status: index > 0 && index % 23 === 0 ? 'failed' : 'completed',
   inProgress: false,
   totalFiles: 5200,
   totalSize: 1200 * 1024 ** 2,
   active: true,
   completionStats: {
      snapshot_id: (237 - index).toString(16).padStart(64, '0'),
      total_files_processed: 5200,
      total_bytes_processed: 1200 * 1024 ** 2,
      files_new: index === 0 ? 2 : 0,
      files_changed: 1,
      files_unmodified: 5197,
   },
   changes: { new: 3, modified: 2, removed: 1 },
   errorMsg: index > 0 && index % 23 === 0 ? 'Synthetic backup failure.' : '',
}));
const storage = {
   id: 'example-storage',
   name: 'Example SFTP',
   type: 'sftp',
   storageTypeName: 'SFTP',
   storageFields: sftpFields,
   authType: 'password',
   defaultPath: '',
   tags: ['example'],
   usedSize: 2048,
   settings: { disable_hashcheck: false, known_hosts_file: '', path_override: '', key_use_agent: false, use_insecure_cipher: false },
   credentials: { host: '192.0.2.20', port: 22, user: 'example_reader', pass: '' },
   plans: [],
   createdAt: new Date().toISOString(),
};
const device = {
   id: 'example-agent',
   ip: '192.0.2.10',
   name: 'app-01',
   type: 'device',
   connected: true,
   createdAt: new Date().toISOString(),
   agentId: 'example-agent-identity',
   versions: { agent: '1.0.0', restic: '0.19.1', rclone: '1.75.1' },
   host: null,
   port: null,
   hostname: 'app-01',
   os: 'linux',
   platform: 'linux',
   disks: [],
   status: 'active',
   isRemote: true,
   lastSeen: new Date().toISOString(),
   plans: [],
   tags: [],
   metrics: {
      system: { manufacturer: 'Example', model: 'Disposable UI fixture', version: '1', serial: '', uuid: '' },
      os: { platform: 'linux', distro: 'Example Linux', release: '24.04', kernel: '6.8', arch: 'x86_64', hostname: 'app-01.example.internal' },
      time: { current: now, uptime: 300000, timezone: 'UTC', timezoneName: 'UTC' },
      cpu: {
         manufacturer: 'Example',
         brand: 'Infrastructure CPU 8-core',
         cores: 8,
         physicalCores: 4,
         speed: 3.2,
         processors: 1,
         cache: {},
         load: { currentLoad: 23, cpus: [] },
      },
      memory: {
         total: 16 * 1024 ** 3,
         available: 12 * 1024 ** 3,
         used: 4 * 1024 ** 3,
         free: 12 * 1024 ** 3,
         active: 4 * 1024 ** 3,
         swapTotal: 0,
         swapFree: 0,
         swapUsed: 0,
         layout: [],
      },
      disks: {
         physical: [],
         filesystems: [
            {
               fs: '/dev/example',
               type: 'ext4',
               size: 100 * 1024 ** 3,
               used: 36 * 1024 ** 3,
               available: 64 * 1024 ** 3,
               use: 36,
               mount: '/srv/example-app',
               name: 'Example data volume',
            },
         ],
      },
      network: [
         {
            iface: 'eth0',
            ifaceName: 'Example private network',
            ip4: '192.0.2.10',
            ip6: '2001:db8::10',
            operstate: 'up',
            type: 'wired',
            internal: false,
         },
      ],
   },
   settings: {},
   agent: {
      agentId: 'example-agent-identity',
      deviceId: 'example-agent',
      status: 'online',
      hostname: 'app-01',
      os: 'linux',
      architecture: 'x64',
      agentVersion: '1.0.0',
      resticVersion: '0.19.1',
      rcloneVersion: '1.75.1',
      capabilities: { filesystemRootsConfigured: true, commandTypes: ['BACKUP_FILESYSTEM'] },
      lastSeen: new Date().toISOString(),
      createdAt: new Date().toISOString(),
   },
};
const plan = {
   ...structuredClone(DEFAULT_PLAN_SETTINGS),
   id: 'example-plan',
   title: 'Example remote backup',
   description: 'Synthetic theme review',
   isActive: true,
   inProgress: false,
   createdAt: new Date().toISOString(),
   lastBackupTime: new Date().toISOString(),
   lastUpdated: null,
   sourceId: device.id,
   sourceType: 'device',
   storageId: storage.id,
   storage,
   storagePath: 'example-repo',
   device,
   sourceConfig: { includes: ['/srv/example-app'], excludes: [] },
   verified: { status: 'completed', result: {}, startedAt: now, endedAt: now, hasError: false },
   stats: { size: 1200 * 1024 ** 2, snapshots: backups.map((backup) => backup.snapshotId) },
   backups: backups.slice(0, 90),
   backupChart: backups.map(({ status, started, completionStats, totalFiles, totalSize }) => ({
      status,
      started,
      completionStats,
      totalFiles,
      totalSize,
   })),
   restores: [
      {
         id: 'example-restore',
         backupId: 'example-backup-0',
         status: 'completed',
         inProgress: false,
         started: now - 1800000,
         ended: now - 1740000,
         createdAt: now - 1800000,
         config: { target: '/srv/example-staging', overwrite: 'never' },
         taskStats: { files_restored: 3, bytes_restored: 2048, total_bytes: 2048, total_files: 3 },
         completionStats: { files_restored: 3, bytes_restored: 2048, total_bytes: 2048, total_files: 3, seconds_elapsed: 60 },
      },
   ],
};
plan.settings.remoteLifecycle = {
   version: 2,
   databases: ['one', 'two'].map((name, index) => ({
      databaseId: `db_example_${name}`,
      engine: index ? 'postgresql' : 'mariadb',
      host: 'localhost',
      port: index ? 5432 : 3306,
      tls: 'local',
      database: `example_${name}`,
      username: 'example_reader',
      dumpFilename: `${name}.sql`,
      timeoutSeconds: 60,
      maxDumpBytes: 1024 ** 3,
      includeRoutines: false,
      includeEvents: false,
      passwordConfigured: true,
   })),
   preHook: { id: 'example-prepare', args: [], timeoutSeconds: 60 },
   postHook: { id: 'example-cleanup', args: [], timeoutSeconds: 60 },
};
const localPlan = {
   ...plan,
   id: 'example-local-plan',
   title: 'Example local backup',
   sourceId: 'main',
   device: { ...device, id: 'main', name: 'Main device' },
};
const files = [
   {
      name: 'srv',
      path: '/srv',
      type: 'dir',
      isDirectory: true,
      size: 0,
      mode: 493,
      permissions: 'drwxr-xr-x',
      owner: 'root',
      modifiedAt: new Date().toISOString(),
   },
   {
      name: 'example-app',
      path: '/srv/example-app',
      type: 'dir',
      isDirectory: true,
      size: 0,
      mode: 493,
      permissions: 'drwxr-xr-x',
      owner: 'root',
      modifiedAt: new Date().toISOString(),
   },
   {
      name: 'example.txt',
      path: '/srv/example-app/example.txt',
      type: 'file',
      isDirectory: false,
      size: 2048,
      mode: 420,
      permissions: '-rw-r--r--',
      owner: 'root',
      modifiedAt: new Date().toISOString(),
   },
];
const settings = { id: 'example-settings', settings: { integration: {}, smtp: {}, maxConcurrentBackups: 2 }, integration: {}, smtp: {} };
const repository = {
   id: 'example-repository',
   displayName: 'Example read-only archive',
   repositoryPath: '/srv/example-archive',
   backend: 'local',
   isReadOnly: true,
   validationStatus: 'available',
   lastValidatedAt: new Date(now).toISOString(),
   createdAt: new Date(now).toISOString(),
   updatedAt: null,
};
const requests: string[] = [];
let failures = 0;
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
   const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href);
   if (!url.pathname.startsWith('/api/')) {
      if (url.origin !== window.location.origin) throw new Error('External requests are blocked in the theme fixture.');
      return realFetch(input, init);
   }
   const path = url.pathname.slice(4);
   const method = init?.method || 'GET';
   requests.push(`${method} ${path}`);
   let result: unknown;
   if (method === 'POST' && path === '/agent-admin/enrollments') {
      result = {
         id: 'example-enrollment',
         token: 'EXAMPLE-NOT-A-REAL-TOKEN',
         expiresAt: new Date(Date.now() + 600000).toISOString(),
         deviceName: 'app-02',
         serverUrl: 'http://192.0.2.10',
         insecureHttpAllowed: true,
      };
   } else if (method === 'POST' && path === '/restores/action/dryrestore') {
      // UI-only preview; this does not start Restic or write a staging directory.
      result = { stats: plan.restores[0].taskStats, files: files.map((file) => ({ ...file, action: 'restored' })) };
   } else if (method === 'POST' && path.startsWith('/recovery-testing/') && path.endsWith('/tests/lookup')) {
      result = [];
   } else if (method !== 'GET') {
      throw new Error('Mutation refused: this theme preview has no backend.');
   } else if (path === '/user/validate') result = { username: 'example_reader' };
   else if (path === '/settings/version/latest') result = { latestVersion: 'dev' };
   else if (path === '/settings') result = settings;
   else if (path === '/plans') result = [plan, localPlan];
   else if (/^\/plans\/example-(?:local-)?plan\/backups$/.test(path)) {
      const query = parseBackupHistoryQuery(Object.fromEntries(url.searchParams));
      const matching = backups.filter(
         (backup) =>
            (query.from === undefined || backup.ended / 1000 >= query.from) && (query.until === undefined || backup.ended / 1000 < query.until),
      );
      const totalPages = Math.max(1, Math.ceil(matching.length / query.pageSize));
      const page = Math.min(query.page, totalPages);
      result = {
         items: matching.slice((page - 1) * query.pageSize, page * query.pageSize),
         total: matching.length,
         page,
         pageSize: query.pageSize,
         totalPages,
         hasPrevious: page > 1,
         hasNext: page < totalPages,
         timeZone: query.timeZone,
      };
   } else if (path === '/plans/example-plan') result = plan;
   else if (path === '/plans/example-local-plan') result = localPlan;
   else if (path.endsWith('/checkactive')) result = { backups: [], restores: [] };
   else if (path.endsWith('/logs'))
      result = [
         { time: new Date().toISOString(), level: 'info', type: 'info', message: 'Synthetic backup started.' },
         { time: new Date().toISOString(), level: 'warn', type: 'warn', message: 'Synthetic warning.' },
         { time: new Date().toISOString(), level: 'error', type: 'error', message: 'Synthetic error.' },
      ];
   else if (path === '/devices') result = [device, { ...device, id: 'main', name: 'Main device', agent: null, isRemote: false }];
   else if (path.startsWith('/devices/')) result = { device, plans: [plan], storages: [storage] };
   else if (path === '/storages/available') result = { sftp: { name: 'SFTP', authTypes: ['password'], settings: sftpFields } };
   else if (path === '/storages')
      result = [
         {
            ...storage,
            usedSize: 1200 * 1024 ** 2,
            plans: [{ id: plan.id, title: plan.title, method: plan.method, stats: plan.stats, isActive: true }],
         },
         { ...storage, id: 'example-archive', name: 'Example Archive SFTP', usedSize: 800 * 1024 ** 2 },
         { ...storage, id: 'example-secondary', name: 'Example Secondary SFTP', usedSize: 0 },
      ];
   else if (path === '/storages/example-storage') result = { ...storage, authTypes: ['password'] };
   else if (path.startsWith('/backups/') && path.endsWith('/files')) result = files;
   else if (path.startsWith('/backups/')) result = backups.find((backup) => path === `/backups/${backup.id}`);
   else if (path === '/legacy-repositories') result = [repository];
   else if (path === '/legacy-repositories/example-repository') result = repository;
   else if (path === '/legacy-repositories/example-repository/stats')
      result = {
         totalSize: 1024 ** 3,
         totalUncompressedSize: 2 * 1024 ** 3,
         compressionRatio: 2,
         totalBlobCount: 500,
         snapshotCount: 1,
      };
   else if (path === '/legacy-repositories/example-repository/snapshots')
      result = {
         items: [
            {
               id: 'a'.repeat(64),
               shortId: 'aaaaaaaa',
               time: new Date(now).toISOString(),
               hostname: 'app-01',
               tags: ['example'],
               paths: ['/srv/example-app'],
            },
         ],
         total: 1,
         page: 1,
         pageSize: 30,
         totalPages: 1,
         workloads: [],
         datasets: [],
      };
   else if (path === '/restores') result = plan.restores;
   else if (path.startsWith('/recovery-testing/') && path.endsWith('/tests')) result = [];
   else throw new Error(`Unmapped synthetic API: ${method} ${path}`);
   return new Response(JSON.stringify({ success: true, result }), {
      headers: { 'content-type': 'application/json', 'x-app-version': 'dev', 'x-install-type': 'dev', 'x-server-os': 'linux' },
   });
};
window.addEventListener('error', () => {
   failures++;
});
window.addEventListener('unhandledrejection', () => {
   failures++;
});

function PreviewControls() {
   const { theme, setTheme } = useTheme();
   const [diagnostics, setDiagnostics] = useState('');
   const [expanded, setExpanded] = useState(true);
   const navigate = useNavigate();
   if (!expanded)
      return (
         <button
            type="button"
            aria-label="Show preview controls"
            onClick={() => setExpanded(true)}
            style={{
               position: 'fixed',
               top: 4,
               right: 8,
               zIndex: 2147483647,
               fontSize: 11,
               background: 'var(--content-background-color)',
               color: 'var(--content-text-color)',
               border: '1px solid var(--line-color)',
               borderRadius: 4,
            }}
         >
            Synthetic fixture · Show controls
         </button>
      );
   return (
      <aside
         style={{
            position: 'fixed',
            left: 8,
            bottom: 8,
            zIndex: 2147483647,
            background: 'var(--content-background-color)',
            color: 'var(--content-text-color)',
            border: '1px solid var(--line-color)',
            padding: 8,
            borderRadius: 6,
            maxWidth: 'calc(100vw - 32px)',
            fontSize: 12,
         }}
      >
         <strong>Synthetic · {theme}</strong> <button onClick={() => setTheme('light')}>Light</button>{' '}
         <button onClick={() => setTheme('dark')}>Dark</button> <button onClick={() => setTheme('auto')}>Auto</button>
         {' · '}
         <Link to="/">Plans</Link>
         {' · '}
         <Link to="/plan/example-plan">Remote plan</Link>
         {' · '}
         <Link to="/plan/example-local-plan">Local plan</Link>
         {' · '}
         <Link to="/storages">Storages</Link>
         {' · '}
         <Link to="/sources">Machines</Link> <Link to="/device/example-agent">Source detail</Link> <button onClick={() => navigate(-1)}>Back</button>{' '}
         <button onClick={() => setExpanded(false)}>Hide preview controls</button>{' '}
         <button
            onClick={() =>
               setDiagnostics(
                  `Browser exceptions: ${failures}\nSynthetic requests: ${requests.length}\nStored theme: ${localStorage.getItem('themeSetting')}\nApplied theme: ${document.documentElement.dataset.theme}`,
               )
            }
         >
            Diagnostics
         </button>
         {diagnostics && <output style={{ display: 'block', whiteSpace: 'pre-line' }}>{diagnostics}</output>}
      </aside>
   );
}
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
const root = createRoot(document.getElementById('root')!);
root.render(
   <QueryClientProvider client={queryClient}>
      <ThemeProvider>
         <MemoryRouter>
            <PreviewControls />
            <AppRoutes />
         </MemoryRouter>
      </ThemeProvider>
   </QueryClientProvider>,
);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
