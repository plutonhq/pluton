import { useState, useCallback } from 'react';

interface UseSnapshotNavigationOptions {
   onDirectoryExpand?: (dir: string) => Promise<string[]>;
   /** Custom split function for paths. Default: split by '/' and filter empty strings. */
   splitPath?: (path: string) => string[];
   /** Custom separator detection per path. Default: always '/'. */
   getPathSeparator?: (path: string) => string;
   /** Whether to prepend separator when building parent paths (e.g. /home vs home). Default: true. */
   hasLeadingSeparator?: boolean;
}

const defaultSplitPath = (path: string) => path.split('/').filter(Boolean);
const defaultGetPathSeparator = () => '/';

export const useSnapshotNavigation = (
   directories: string[],
   expandedFolders: Set<string>,
   setExpandedFolders: React.Dispatch<React.SetStateAction<Set<string>>>,
   options?: UseSnapshotNavigationOptions,
) => {
   const [selectedFolder, setSelectedFolder] = useState<string>('');

   const splitPathFn = options?.splitPath || defaultSplitPath;
   const getPathSeparatorFn = options?.getPathSeparator || defaultGetPathSeparator;
   const hasLeadingSep = options?.hasLeadingSeparator ?? true;

   const hasSubdirectories = useCallback(
      (dir: string) => {
         const sep = getPathSeparatorFn(dir);
         return directories.some((d) => d !== dir && d.startsWith(dir + sep));
      },
      [directories, getPathSeparatorFn],
   );

   const isVisible = useCallback(
      (dir: string) => {
         const parts = splitPathFn(dir);
         if (parts.length <= 1) return true;

         const sep = getPathSeparatorFn(dir);
         const parentParts = parts.slice(0, -1);
         let parentPath = '';

         return parentParts.every((part) => {
            if (!parentPath) {
               parentPath = hasLeadingSep ? `${sep}${part}` : part;
            } else {
               parentPath = `${parentPath}${sep}${part}`;
            }
            return expandedFolders.has(parentPath);
         });
      },
      [expandedFolders, splitPathFn, getPathSeparatorFn, hasLeadingSep],
   );

   const expandParentFolders = useCallback(
      (dirPath: string) => {
         setExpandedFolders((prev) => {
            const newExpanded = new Set(prev);
            const parts = splitPathFn(dirPath);
            const sep = getPathSeparatorFn(dirPath);
            let currentPath = '';

            parts.forEach((part) => {
               if (!currentPath) {
                  currentPath = hasLeadingSep ? `${sep}${part}` : part;
               } else {
                  currentPath = `${currentPath}${sep}${part}`;
               }
               newExpanded.add(currentPath);
            });

            return newExpanded;
         });
      },
      [setExpandedFolders, splitPathFn, getPathSeparatorFn, hasLeadingSep],
   );

   const toggleFolder = useCallback(
      async (dir: string) => {
         setExpandedFolders((prev) => {
            const newExpanded = new Set(prev);
            if (newExpanded.has(dir)) {
               newExpanded.delete(dir);
            } else {
               newExpanded.add(dir);
            }
            return newExpanded;
         });

         // If expanding and progressive loading, discover subdirectories
         if (!expandedFolders.has(dir) && options?.onDirectoryExpand) {
            try {
               await options.onDirectoryExpand(dir);
            } catch (error) {
               console.error('Error discovering subdirectories:', error);
            }
         }
      },
      [expandedFolders, setExpandedFolders, options],
   );

   const handleGoUp = useCallback(() => {
      if (!selectedFolder) return;
      const sep = getPathSeparatorFn(selectedFolder);
      const lastSepIndex = selectedFolder.lastIndexOf(sep);
      if (lastSepIndex <= 0) {
         setSelectedFolder('');
      } else {
         setSelectedFolder(selectedFolder.substring(0, lastSepIndex));
      }
   }, [selectedFolder, getPathSeparatorFn]);

   const handleDirectoryClick = useCallback(
      async (path: string) => {
         expandParentFolders(path);
         setSelectedFolder(path);

         // If progressive loading, discover subdirectories when navigating
         if (options?.onDirectoryExpand) {
            try {
               await options.onDirectoryExpand(path);
            } catch (error) {
               console.error('Error discovering subdirectories:', error);
            }
         }
      },
      [expandParentFolders, options],
   );

   const getParentPath = useCallback(
      (path: string) => {
         if (!path) return null;
         const sep = getPathSeparatorFn(path);
         const lastSepIndex = path.lastIndexOf(sep);
         if (lastSepIndex <= 0) return '';
         return path.substring(0, lastSepIndex);
      },
      [getPathSeparatorFn],
   );

   return {
      selectedFolder,
      setSelectedFolder,
      hasSubdirectories,
      isVisible,
      expandParentFolders,
      toggleFolder,
      handleGoUp,
      handleDirectoryClick,
      getParentPath,
   };
};
