// Helper function to detect path separator and normalize paths
export const getPathSeparator = (path: string): string => {
   return path.includes('\\') ? '\\' : '/';
};

// Normalizes the path
// the path is formatted like this for Windows: \\E\\pluton_files_viewer_test or for Linux: /home/towfiqi/games/Battle Realm
export const normalizePath = (path: string): string => {
   // Remove leading slashes/backslashes for consistency but keep the structure
   return path.replace(/^[\\\/]+/, '');
};

export const splitPath = (path: string): string[] => {
   const separator = getPathSeparator(path);
   const normalized = normalizePath(path);
   return normalized ? normalized.split(separator) : [];
};

const joinPath = (parts: string[], separator: string): string => {
   return parts.join(separator);
};

export const getParentPath = (path: string): string => {
   const separator = getPathSeparator(path);
   const parts = splitPath(path);
   parts.pop(); // Remove the last part (filename)
   return parts.length > 0 ? joinPath(parts, separator) : '';
};
