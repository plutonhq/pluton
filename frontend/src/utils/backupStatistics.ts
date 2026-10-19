export const statisticHelp = {
   snapshotSize: 'Logical data represented by this snapshot, not physical repository usage. Restic can reuse blocks from earlier snapshots.',
   newFiles: 'Files new to the selected parent snapshot. This is change tracking, not the number of newly stored content blocks.',
   dataAdded: 'New uncompressed data and tree blobs added by this backup after content deduplication.',
   packed: 'New data/tree blobs after compression. This is not a measurement of total repository disk usage or complete storage overhead.',
   deduplication:
      'Restic reuses matching content blocks, including when no compatible parent was found. File counts alone cannot measure a deduplication ratio.',
};

export function backupStatistics(stats?: Record<string, unknown> | null) {
   const value = (name: string): number | undefined =>
      typeof stats?.[name] === 'number' && Number.isFinite(stats[name]) && (stats[name] as number) >= 0 ? (stats[name] as number) : undefined;
   return {
      totalFiles: value('total_files_processed'),
      newFiles: value('files_new'),
      modifiedFiles: value('files_changed'),
      unmodifiedFiles: value('files_unmodified'),
      logicalBytes: value('total_bytes_processed'),
      dataAdded: value('data_added'),
      packedAdded: value('data_added_packed'),
      // Restic backup summary has no deleted-files or physical repository-usage counter.
      deletedFiles: undefined,
      physicalRepositoryBytes: undefined,
   };
}
type SizeBackup = { status: string; started: number | string; completionStats?: { total_bytes_processed: number } | null };
export function latestLogicalSnapshotBytes(backups: SizeBackup[]): number | undefined {
   const latest = backups
      .filter((backup) => backup.status === 'completed' && backup.completionStats)
      .slice()
      .sort((a, b) => new Date(b.started).getTime() - new Date(a.started).getTime())[0];
   return backupStatistics(latest?.completionStats as unknown as Record<string, unknown>).logicalBytes;
}
export function planReportedSize(plan: {
   method: string;
   sourceType: string;
   sourceId: string;
   backups?: SizeBackup[];
   stats: { size: number };
}): number | undefined {
   return plan.method === 'backup' && plan.sourceType === 'device' && plan.sourceId !== 'main'
      ? latestLogicalSnapshotBytes(plan.backups || [])
      : plan.stats.size;
}
