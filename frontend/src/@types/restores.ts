export interface Restore {
   id: number;
   status: string;
   error: string | null;
   taskStats: {
      total_files: number;
      files_restored: number;
      total_bytes: number;
      bytes_restored: number;
   } | null;
   config: {
      target: string;
      overwrite: string;
   };
   backupId: string;
   planId: string;
   sourceId: string;
   sourceType: string;
   planName: string;
   storage: {
      id: string;
      path: string;
      name: string;
      type: string;
   };
   deviceName: string;
   endedAt: number;
   createdAt: number;
   completionStats?: {
      files_restored: number;
      bytes_restored: number;
      total_bytes: number;
      total_files: number;
      seconds_elapsed: number;
   };
}

export interface RestoreSlim {
   id: string;
   status: 'completed' | 'cancelled' | 'failed' | 'started';
   error: string | null;
   taskStats: RestoredItemsStats | null;
   config: {
      target: string;
      overwrite: string;
   };
   backupId: string;
   planId: string;
   started: number;
   ended: number;
   createdAt: number;
   errorMsg?: string;
   completionStats?: {
      files_restored: number;
      bytes_restored: number;
      total_bytes: number;
      total_files: number;
      seconds_elapsed: number;
   };
}

export interface RestoredFileItem {
   path: string;
   size: number;
   action: 'unchanged' | 'restored' | 'updated';
   isDirectory?: boolean;
}

export interface RestoredItemsStats {
   total_files: number;
   files_restored: number;
   total_bytes: number;
   bytes_restored: number;
}

export type FileChangeStatus = 'added' | 'removed' | 'modified' | 'unchanged';

export type RestoreFileWithStatus = RestoreFileItem & {
   status: FileChangeStatus;
};

export type RestoreFileItem = {
   name: string;
   path: string;
   type: 'directory' | 'file' | 'dir';
   isDirectory: boolean;
   size: number;
   modifiedAt: string;
   owner: string;
   permissions: string | number;
   changeType?: string;
   srcPath?: string;
};

export interface RestoreFileSystemData {
   [key: string]: RestoreFileWithStatus[];
}

export interface BackupFileLoaderProps {
   backupId: string;
   extension: string;
   activeFile: RestoreFileItem;
   files?: RestoreFileItem[];
   compareBackupId?: string;
   onClose?: () => void;
}

export interface RestoreSettings {
   type: 'original' | 'custom';
   path: string;
   overwrite: 'always' | 'if-changed' | 'if-newer' | 'never';
   includes: string[];
   excludes: string[];
   delete: boolean;
}
