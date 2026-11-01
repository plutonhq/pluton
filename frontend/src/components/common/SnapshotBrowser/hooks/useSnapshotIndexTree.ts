import { useCallback, useEffect, useMemo, useState } from 'react';
import { SNAPSHOT_INDEX_PAGE_SIZE, useSnapshotDirs, useSnapshotIndex } from '../../../../services/backups';
import { SnapshotIndexDir } from '../../../../@types/backups';

const ROOT = '/';
const AUTO_EXPANDED_FOLDERS = 2;

interface UseSnapshotIndexTreeOptions {
   backupId: string;
   replicationId?: string;
   enabled?: boolean;
}

export const useSnapshotIndexTree = ({ backupId, replicationId, enabled = true }: UseSnapshotIndexTreeOptions) => {
   const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
   const [pageCounts, setPageCounts] = useState<Record<string, number>>({});
   const [autoExpanded, setAutoExpanded] = useState(false);

   // A reset in an effect comes too late: one render would ask the new storage for the old folders.
   const target = `${backupId}|${replicationId || ''}`;
   const [treeTarget, setTreeTarget] = useState(target);
   if (treeTarget !== target) {
      setTreeTarget(target);
      setExpandedFolders(new Set());
      setPageCounts({});
      setAutoExpanded(false);
   }

   const index = useSnapshotIndex({ backupId, replicationId, enabled });
   const status = index.data;
   const ready = status?.state === 'ready' ? status : undefined;
   const builtAt = ready?.builtAt;
   const restartIndex = index.refetch;

   const pages = useMemo(
      () =>
         [ROOT, ...expandedFolders].flatMap((parent) =>
            Array.from({ length: pageCounts[parent] ?? 1 }, (_, page) => ({ parent, offset: page * SNAPSHOT_INDEX_PAGE_SIZE })),
         ),
      [expandedFolders, pageCounts],
   );

   const dirs = useSnapshotDirs({ backupId, replicationId, builtAt, pages, enabled: enabled && !!ready });

   const { discoveredDirectories, directoryInfo, loadMoreAfter } = useMemo(() => {
      const children = new Map<string, SnapshotIndexDir[]>();
      const totals = new Map<string, number>();
      pages.forEach(({ parent }, position) => {
         const page = dirs.data[position];
         if (page) {
            children.set(parent, [...(children.get(parent) ?? []), ...page.dirs]);
            totals.set(parent, page.total);
         }
      });

      const discovered: string[] = [];
      const info = new Map<string, SnapshotIndexDir>();
      const more = new Map<string, string[]>();
      const addChildren = (parent: string) => {
         const list = children.get(parent) ?? [];
         for (const dir of list) {
            discovered.push(dir.path);
            info.set(dir.path, dir);
            addChildren(dir.path);
         }
         const last = discovered[discovered.length - 1];
         if (list.length > 0 && list.length < (totals.get(parent) ?? 0)) {
            more.set(last, [...(more.get(last) ?? []), parent]);
         }
      };
      addChildren(ROOT);

      return { discoveredDirectories: discovered, directoryInfo: info, loadMoreAfter: more };
   }, [pages, dirs.data]);

   useEffect(() => {
      if (autoExpanded || discoveredDirectories.length === 0) return;
      setAutoExpanded(true);
      setExpandedFolders(new Set(discoveredDirectories.slice(0, AUTO_EXPANDED_FOLDERS)));
   }, [autoExpanded, discoveredDirectories]);

   useEffect(() => {
      if (dirs.error?.message === 'index_not_ready') restartIndex();
   }, [dirs.error, restartIndex]);

   const hasSubdirectories = useCallback((dir: string) => (directoryInfo.get(dir)?.subDirs ?? 0) > 0, [directoryInfo]);

   const loadMoreDirectories = useCallback((parent: string) => {
      setPageCounts((prev) => ({ ...prev, [parent]: (prev[parent] ?? 1) + 1 }));
   }, []);

   return {
      status,
      statusError: index.error,
      builtAt,
      restartIndex,
      discoveredDirectories,
      expandedFolders,
      setExpandedFolders,
      hasSubdirectories,
      loadMoreAfter,
      loadMoreDirectories,
      isLoadingDirectories: dirs.isFetching,
      directoriesError: dirs.error,
   };
};
