import { useState, useEffect, useCallback } from 'react';
import { SnapshotDatabase } from '../../../../utils';
import { FileItem } from '../../../../@types';

export const useSnapshotDatabase = (files: FileItem[], backupId: string, useProgressiveLoading: boolean) => {
   const [db, setDb] = useState<SnapshotDatabase | null>(null);
   const [initError, setInitError] = useState<string | null>(null);
   const [discoveredDirectories, setDiscoveredDirectories] = useState<string[]>([]);
   const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

   // Helper function to sort directories in true hierarchical order
   const sortDirectoriesHierarchically = useCallback((dirs: string[]): string[] => {
      const tree: { [key: string]: string[] } = {};
      const roots: string[] = [];

      // Build parent-child relationships
      dirs.forEach((dir) => {
         const parentPath = dir.substring(0, dir.lastIndexOf('/')) || '';
         if (!tree[parentPath]) {
            tree[parentPath] = [];
         }
         tree[parentPath].push(dir);
      });

      // Find root directories (those whose parent is not in the list)
      dirs.forEach((dir) => {
         const parentPath = dir.substring(0, dir.lastIndexOf('/')) || '';
         if (parentPath === '' || !dirs.includes(parentPath)) {
            roots.push(dir);
         }
      });

      // Recursively build sorted list
      const sortedList: string[] = [];

      const addChildrenRecursively = (parent: string) => {
         const children = tree[parent] || [];
         children.sort((a, b) => {
            const nameA = a.split('/').pop() || '';
            const nameB = b.split('/').pop() || '';
            return nameA.localeCompare(nameB);
         });

         children.forEach((child) => {
            sortedList.push(child);
            addChildrenRecursively(child);
         });
      };

      roots.sort((a, b) => {
         const nameA = a.split('/').pop() || '';
         const nameB = b.split('/').pop() || '';
         return nameA.localeCompare(nameB);
      });

      roots.forEach((root) => {
         sortedList.push(root);
         addChildrenRecursively(root);
      });

      return sortedList;
   }, []);

   // Helper function to add new directories while maintaining sorted order
   const addDirectoriesSorted = useCallback(
      (newDirs: string[]) => {
         setDiscoveredDirectories((prev) => {
            const allDirs = [...prev, ...newDirs];
            const uniqueDirs = Array.from(new Set(allDirs));
            return sortDirectoriesHierarchically(uniqueDirs);
         });
      },
      [sortDirectoriesHierarchically],
   );

   // Initialize database
   useEffect(() => {
      const initDb = async () => {
         try {
            console.log('Initializing database for', files.length, 'files');
            const database = new SnapshotDatabase(backupId);
            await database.initializeFromFiles(files);
            setDb(database);
            console.log('Database initialized successfully');

            if (useProgressiveLoading) {
               // Load only top-level directories initially
               const topDirs = await database.getTopLevelDirectories(3);
               const sortedTopDirs = sortDirectoriesHierarchically(topDirs);
               setDiscoveredDirectories(sortedTopDirs);
               console.log('Loaded top-level directories:', sortedTopDirs.length);

               const initialExpanded = new Set<string>();
               sortedTopDirs.slice(0, 2).forEach((dir) => initialExpanded.add(dir));
               setExpandedFolders(initialExpanded);
            } else {
               // For smaller datasets, load all directories
               const allDirs = await database.getTopLevelDirectories(999);
               const sortedAllDirs = sortDirectoriesHierarchically(allDirs);
               setDiscoveredDirectories(sortedAllDirs);

               const initialExpanded = new Set<string>();
               sortedAllDirs.slice(0, 3).forEach((dir) => initialExpanded.add(dir));
               setExpandedFolders(initialExpanded);
            }
         } catch (error) {
            console.error('Failed to initialize database:', error);
            setInitError(error instanceof Error ? error.message : 'Unknown error');
         }
      };

      initDb();

      return () => {
         if (db) {
            db.cleanup().catch(console.error);
         }
      };
   }, [files, backupId, useProgressiveLoading, sortDirectoriesHierarchically]);

   return {
      db,
      initError,
      discoveredDirectories,
      expandedFolders,
      setExpandedFolders,
      setDiscoveredDirectories,
      addDirectoriesSorted,
   };
};
