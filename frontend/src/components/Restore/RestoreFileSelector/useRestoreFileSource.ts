import { useCallback, useEffect, useMemo, useState } from 'react';
import { RestoreFileItem } from '../../../@types/restores';
import { SnapshotIndexRow, SnapshotIndexStatus } from '../../../@types/backups';
import { calculateDirectorySizes, sortFileItems } from '../../../utils/helpers';
import { getParentPath, getPathSeparator, normalizePath, splitPath } from '../../../utils/restore';
import { useSnapshotEntries, useSnapshotSelection } from '../../../services/backups';
import { useSnapshotIndexTree } from '../../common/SnapshotBrowser/hooks/useSnapshotIndexTree';
import { useSnapshotNavigation } from '../../common/SnapshotBrowser/hooks/useSnapshotNavigation';

const SEARCH_DELAY = 300;

export interface RestoreSelection {
   include: Set<string>;
   exclude: Set<string>;
}

/**
 * A normalized include list selects its paths only, but it has no root rule, and with
 * no root rule the server selects everything. Use this on a list that comes from settings.
 */
export const withRootRule = (includes: string[], excludes: string[]) => (includes.length > 0 && excludes.length === 0 ? ['/'] : excludes);

interface RestoreFileSourceOptions {
   search: string;
   sortField: 'name' | 'modifiedAt' | 'size';
   sortDirection: 'asc' | 'desc';
   selection: RestoreSelection;
}

export interface RestoreFileSource {
   directories: string[];
   hasSubdirectories: (dir: string) => boolean;
   expandedFolders: Set<string>;
   isVisible: (dir: string) => boolean;
   toggleFolder: (dir: string) => void;
   selectedFolder: string;
   /** Folder for the file list. Null shows the list as not selected. */
   listFolder: string | null;
   selectFolder: (dir: string) => void;
   openFolder: (file: RestoreFileItem) => void;
   goUp: () => void;
   /** Rows of the selected folder. Null is the go-up row. */
   children: (RestoreFileItem | null)[];
   summary: { selectedFiles: number; totalFiles: number; selectedBytes: number; totalBytes: number };
   isDirectory: (file: RestoreFileItem) => boolean;
   originalPath: (dir: string) => string;
   displaySize: (file: RestoreFileItem) => number;
   loadMore?: () => void;
   isLoadingList?: boolean;
   listError?: string;
   selectionError?: string;
   directoryProps?: {
      useProgressiveLoading: boolean;
      totalDirectories?: number;
      emptyMessage?: string;
      loadMoreAfter: Map<string, string[]>;
      onLoadMore: (parent: string) => void;
      isLoadingMore: boolean;
   };
   index?: { status?: SnapshotIndexStatus; error: Error | null; ready: boolean; retry: () => void };
}

export const useInMemoryFileSource = (
   files: RestoreFileItem[],
   {
      search,
      sortField,
      sortDirection,
      selection,
      isPathSelected,
      fileSelectCondition,
   }: RestoreFileSourceOptions & {
      isPathSelected: (path: string) => boolean;
      fileSelectCondition?: (file: RestoreFileItem) => boolean;
   },
): RestoreFileSource => {
   const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => {
      const allPaths = new Set<string>();
      files.forEach((file) => {
         const separator = getPathSeparator(file.path);
         const parts = splitPath(file.path);
         let currentPath = '';

         parts.forEach((part, index) => {
            currentPath = currentPath ? `${currentPath}${separator}${part}` : part;
            if (index < 3) {
               allPaths.add(currentPath);
            }
         });
      });
      return allPaths;
   });

   const fileSystem = useMemo(() => {
      const system: { [key: string]: RestoreFileItem[] } = {};
      const dirSizes = calculateDirectorySizes(files);
      files
         .filter((file) => {
            const matchesSearch = file.path.toLowerCase().includes(search.toLowerCase());
            return matchesSearch;
         })
         .forEach((file) => {
            let theFile = file;
            const dirPath = getParentPath(theFile.path);
            // Use the normalized path as key, but handle root directory
            const normalizedDirPath = normalizePath(dirPath) || '/'; // Use '/' for root

            if (theFile.isDirectory) {
               theFile.size = dirSizes[theFile.path] || 0;
            }

            if (!system[normalizedDirPath]) {
               system[normalizedDirPath] = [];
            }
            system[normalizedDirPath].push(theFile);
         });

      return system;
   }, [files, search]);

   const directories = useMemo(() => {
      const dirs = files.filter((file) => file.isDirectory).map((file) => normalizePath(file.path));

      // Sort directories by their path to ensure proper hierarchical order
      const sortedDirs = dirs.sort((a, b) => {
         const aParts = splitPath(a);
         const bParts = splitPath(b);
         const minLength = Math.min(aParts.length, bParts.length);

         for (let i = 0; i < minLength; i++) {
            const comparison = aParts[i].localeCompare(bParts[i]);
            if (comparison !== 0) {
               return comparison;
            }
         }
         return aParts.length - bParts.length;
      });

      return sortedDirs;
   }, [files]);

   const { selectedFolder, setSelectedFolder, hasSubdirectories, isVisible, expandParentFolders, toggleFolder } = useSnapshotNavigation(
      directories,
      expandedFolders,
      setExpandedFolders,
      { splitPath, getPathSeparator, hasLeadingSeparator: false },
   );

   // Set the first directory as selected by default
   useEffect(() => {
      if (directories.length > 0 && selectedFolder === '') {
         setSelectedFolder(directories[0]);
      }
   }, [directories, selectedFolder, setSelectedFolder]);

   const summary = useMemo(() => {
      let selectedFilesCount = 0;
      let selectedBytes = 0;

      const restorableFiles = fileSelectCondition ? files.filter((file) => fileSelectCondition(file)) : files;

      restorableFiles.forEach((file) => {
         if (isPathSelected(file.path)) {
            selectedFilesCount++;
            if (!file.isDirectory) {
               selectedBytes += file.size;
            }
         }
      });

      return {
         selectedFiles: selectedFilesCount,
         totalFiles: restorableFiles.length,
         selectedBytes,
         totalBytes: restorableFiles.reduce((acc, file) => acc + (!file.isDirectory ? file.size : 0), 0),
      };
   }, [files, selection]);

   const children = useMemo(() => {
      if (!selectedFolder) return [];

      const items = fileSystem[selectedFolder] || [];
      const folders = items.filter((item) => item.isDirectory);
      const plainFiles = items.filter((item) => !item.isDirectory);
      const sorted = [
         ...(sortFileItems(folders, sortField, sortDirection) as RestoreFileItem[]),
         ...(sortFileItems(plainFiles, sortField, sortDirection) as RestoreFileItem[]),
      ];
      const hasParent = getParentPath(selectedFolder) !== selectedFolder;

      // Add parent navigation item if needed
      return hasParent ? [null, ...sorted] : sorted;
   }, [selectedFolder, fileSystem, sortField, sortDirection]);

   return {
      directories,
      hasSubdirectories,
      expandedFolders,
      isVisible,
      toggleFolder,
      selectedFolder,
      listFolder: selectedFolder || null,
      selectFolder: setSelectedFolder,
      openFolder: (file) => {
         const normalizedPath = normalizePath(file.path);
         expandParentFolders(normalizedPath);
         setSelectedFolder(normalizedPath);
      },
      goUp: () => {
         const normalizedParentPath = normalizePath(getParentPath(selectedFolder));
         if (!normalizedParentPath || normalizedParentPath === '') return;
         expandParentFolders(normalizedParentPath);
         setSelectedFolder(normalizedParentPath);
      },
      children,
      summary,
      isDirectory: (file) => directories.includes(normalizePath(file.path)),
      originalPath: (dir) => files.find((f) => f.isDirectory && normalizePath(f.path) === dir)?.path || dir,
      displaySize: (file) => file.size || 0,
   };
};

export const useIndexedFileSource = (
   backupId: string,
   replicationId: string | undefined,
   enabled: boolean,
   { search, sortField, sortDirection, selection }: RestoreFileSourceOptions,
): RestoreFileSource => {
   const tree = useSnapshotIndexTree({ backupId, replicationId, enabled });
   const { status, statusError, builtAt, restartIndex } = tree;
   const { selectedFolder, handleGoUp, handleDirectoryClick, toggleFolder, isVisible } = useSnapshotNavigation(
      tree.discoveredDirectories,
      tree.expandedFolders,
      tree.setExpandedFolders,
   );

   const [indexSearch, setIndexSearch] = useState('');
   useEffect(() => {
      const timer = setTimeout(() => setIndexSearch(search.trim()), SEARCH_DELAY);
      return () => clearTimeout(timer);
   }, [search]);

   const entries = useSnapshotEntries({
      backupId,
      replicationId,
      builtAt,
      dir: selectedFolder,
      sort: sortField,
      order: sortDirection,
      q: indexSearch,
      enabled: enabled && builtAt !== undefined,
   });
   const { data: entriesData, error: entriesError, hasNextPage, isFetchingNextPage, fetchNextPage } = entries;

   const includes = useMemo(() => Array.from(selection.include), [selection]);
   const excludes = useMemo(() => Array.from(selection.exclude), [selection]);
   const selected = useSnapshotSelection({ backupId, replicationId, builtAt, includes, excludes, enabled: enabled && builtAt !== undefined });

   useEffect(() => {
      if (entriesError?.message === 'index_not_ready' || selected.error?.message === 'index_not_ready') restartIndex();
   }, [entriesError, selected.error, restartIndex]);

   const children = useMemo(() => {
      const rows = (entriesData?.pages.flatMap((page) => page.rows) ?? []) as (RestoreFileItem & SnapshotIndexRow)[];
      return selectedFolder ? [null, ...rows] : rows;
   }, [entriesData, selectedFolder]);

   const loadMore = useCallback(() => {
      if (hasNextPage && !isFetchingNextPage) fetchNextPage();
   }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

   return {
      directories: tree.discoveredDirectories,
      hasSubdirectories: tree.hasSubdirectories,
      expandedFolders: tree.expandedFolders,
      isVisible,
      toggleFolder,
      selectedFolder,
      listFolder: selectedFolder,
      selectFolder: handleDirectoryClick,
      openFolder: (file) => handleDirectoryClick(file.path),
      goUp: handleGoUp,
      children,
      summary: {
         selectedFiles: selected.data?.selected.items ?? 0,
         totalFiles: selected.data?.total.items ?? 0,
         selectedBytes: selected.data?.selected.bytes ?? 0,
         totalBytes: selected.data?.total.bytes ?? 0,
      },
      isDirectory: (file) => file.isDirectory,
      originalPath: (dir) => dir,
      displaySize: (file) => (file as SnapshotIndexRow).dirBytes ?? (file.size || 0),
      loadMore,
      isLoadingList: entries.isFetching,
      listError: !entriesData ? entriesError?.message : undefined,
      selectionError: selected.error?.message,
      directoryProps: {
         useProgressiveLoading: tree.isLoadingDirectories,
         totalDirectories: status?.state === 'ready' ? status.stats.dirs : undefined,
         emptyMessage: tree.directoriesError?.message,
         loadMoreAfter: tree.loadMoreAfter,
         onLoadMore: tree.loadMoreDirectories,
         isLoadingMore: tree.isLoadingDirectories,
      },
      index: { status, error: statusError, ready: status?.state === 'ready', retry: restartIndex },
   };
};
