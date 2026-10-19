const labels: Record<string, string> = {
   queued: 'Queued — waiting for agent',
   'preparing-backup': 'Preparing backup',
   'validating-source': 'Validating source access',
   'preparing-storage': 'Preparing private storage configuration',
   'checking-existing-snapshot': 'Checking existing snapshot',
   'preparing-database': 'Preparing database lifecycle',
   'pre-backup': 'Running pre-backup hook',
   'dumping-database': 'Dumping database',
   'preparing-repository': 'Preparing repository',
   'backing-up': 'Backing up',
   'verifying-snapshot': 'Verifying exact snapshot',
   'post-backup': 'Running post-backup hook',
   cleanup: 'Cleaning temporary state',
   completed: 'Backup complete',
   failed: 'Backup failed',
   cancelled: 'Backup cancelled',
};
export function remoteProgressView(data: { remote?: boolean; status?: string; backupStage?: string; attempt?: number } | null | undefined) {
   if (!data?.remote) return null;
   const terminal = ['completed', 'failed', 'cancelled'].includes(data.status || '');
   return {
      indeterminate: !terminal,
      completed: data.status === 'completed',
      message: labels[terminal ? data.status! : data.backupStage || 'queued'] || 'Agent backup in progress',
      attempt: data.attempt || 1,
   };
}
