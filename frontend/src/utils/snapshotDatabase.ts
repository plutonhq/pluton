import { FileItem } from '../@types/system';

// Lazy load Dexie only when needed
let DexieModule: any = null;

async function loadDexie() {
   if (!DexieModule) {
      DexieModule = await import('dexie');
   }
   return DexieModule;
}

interface FileRecord extends FileItem {
   id?: number;
   parentPath: string;
   fileName: string;
   depth: number;
   isDirFlag: number; // 1 for directory, 0 for file
}

class SnapshotDatabase {
   private db: any = null;
   private isInitialized = false;

   constructor(private backupId: string) {}

   async initialize() {
      if (this.isInitialized) return;

      const { Dexie } = await loadDexie();

      this.db = new Dexie(`SnapshotDB_${this.backupId}`);
      this.db.version(1).stores({
         files: '++id, path, parentPath, fileName, isDirFlag, size, modifiedAt, depth',
      });

      this.isInitialized = true;
   }

   async initializeFromFiles(files: FileItem[]) {
      await this.initialize();

      // Clear existing data
      await this.db.files.clear();

      // Process and insert files in batches
      const batchSize = 1000;
      const records: FileRecord[] = [];

      for (let i = 0; i < files.length; i++) {
         const file = files[i];
         const lastSlashIndex = file.path.lastIndexOf('/');
         const parentPath = file.path.substring(0, lastSlashIndex);
         const fileName = (file.name || file.path.split('/').pop() || '').toLowerCase();
         const depth = file.path.split('/').filter(Boolean).length;

         const isDirFlag = file.isDirectory ? 1 : 0;

         records.push({
            ...file,
            parentPath,
            fileName,
            depth,
            isDirFlag,
         });

         if (records.length >= batchSize) {
            await this.db.files.bulkAdd(records);
            records.length = 0;
         }
      }

      if (records.length > 0) {
         await this.db.files.bulkAdd(records);
      }

      console.log('Database initialized with', await this.db.files.count(), 'total records');
   }

   // Get only top-level directories (depth <= maxDepth)
   async getTopLevelDirectories(maxDepth: number = 3): Promise<string[]> {
      if (!this.isInitialized) await this.initialize();

      try {
         const dirRecords = await this.db.files
            .where('isDirFlag')
            .equals(1)
            .and((record: FileRecord) => record.depth <= maxDepth)
            .toArray();

         const paths = dirRecords.map((record: FileRecord) => record.path);
         console.log(`getTopLevelDirectories (depth <= ${maxDepth}) returning:`, paths.length, 'directories');
         return paths;
      } catch (error) {
         console.error('Error getting top-level directories:', error);
         return [];
      }
   }

   // Check if a directory has subdirectories
   async hasSubdirectories(dirPath: string): Promise<boolean> {
      if (!this.isInitialized) await this.initialize();

      try {
         const count = await this.db.files
            .where('parentPath')
            .equals(dirPath)
            .and((record: FileRecord) => record.isDirFlag === 1)
            .count();

         return count > 0;
      } catch (error) {
         console.error('Error checking subdirectories:', error);
         return false;
      }
   }

   // Get immediate subdirectories of a given directory
   async getSubdirectories(parentPath: string): Promise<string[]> {
      if (!this.isInitialized) await this.initialize();

      try {
         const subdirs = await this.db.files
            .where('parentPath')
            .equals(parentPath)
            .and((record: FileRecord) => record.isDirFlag === 1)
            .toArray();

         const paths = subdirs.map((record: FileRecord) => record.path);
         console.log(`getSubdirectories for ${parentPath}:`, paths.length, 'subdirectories');
         return paths;
      } catch (error) {
         console.error('Error getting subdirectories:', error);
         return [];
      }
   }

   // Get directory contents (files and folders in a specific directory)
   async getDirectoryContents(
      dirPath: string,
      sortField: string = 'name',
      sortDirection: string = 'asc',
      searchTerm: string = '',
   ): Promise<FileItem[]> {
      if (!this.isInitialized) await this.initialize();

      try {
         let results: FileRecord[];

         if (searchTerm.trim()) {
            const allInDir = await this.db.files.where('parentPath').equals(dirPath).toArray();
            const lowerSearch = searchTerm.toLowerCase();
            results = allInDir.filter((item: FileRecord) => item.fileName.includes(lowerSearch) || item.path.toLowerCase().includes(lowerSearch));
         } else {
            results = await this.db.files.where('parentPath').equals(dirPath).toArray();
         }

         // Sort results
         results.sort((a: FileRecord, b: FileRecord) => {
            // Directories first
            if (a.isDirFlag && !b.isDirFlag) return -1;
            if (!a.isDirFlag && b.isDirFlag) return 1;

            let aVal: any, bVal: any;
            switch (sortField) {
               case 'name':
                  aVal = a.fileName;
                  bVal = b.fileName;
                  break;
               case 'modifiedAt':
                  aVal = new Date(a.modifiedAt).getTime();
                  bVal = new Date(b.modifiedAt).getTime();
                  break;
               case 'size':
                  aVal = a.size || 0;
                  bVal = b.size || 0;
                  break;
               default:
                  return 0;
            }

            if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
            if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
            return 0;
         });

         return results;
      } catch (error) {
         console.error('Error getting directory contents:', error);
         return [];
      }
   }

   async cleanup() {
      if (this.db) {
         await this.db.delete();
      }
   }
}

export default SnapshotDatabase;
