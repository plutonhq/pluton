export type FileItem = {
   name: string;
   path: string;
   type: 'directory' | 'file' | 'dir';
   isDirectory: boolean;
   modifiedAt: string;
   owner: string;
   permissions: string | number;
   size?: number;
   srcPath?: string;
};
