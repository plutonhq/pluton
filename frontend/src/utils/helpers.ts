import { storageOptionField } from '../@types/storages';
import { FileItem } from '../@types/system';

export const isMobile = (): boolean => {
   // Server-side rendering check
   if (typeof navigator === 'undefined' || typeof window === 'undefined') {
      return false;
   }

   const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera || '';

   // Check for mobile user agents
   const mobileRegex = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS/i;

   // Check for touch capability and screen size
   const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
   const smallScreen = window.innerWidth <= 768;

   // Primary check: user agent
   if (mobileRegex.test(userAgent)) {
      return true;
   }

   // Secondary check: touch + small screen (for edge cases)
   if (hasTouch && smallScreen) {
      return true;
   }

   return false;
};

const formatter = new Intl.RelativeTimeFormat('en');
export const timeAgo = (input: Date) => {
   const date = input instanceof Date ? input : new Date(input);
   const ranges: { [k: string]: number } = {
      years: 3600 * 24 * 365,
      months: 3600 * 24 * 30,
      weeks: 3600 * 24 * 7,
      days: 3600 * 24,
      hours: 3600,
      minutes: 60,
      seconds: 1,
   };
   const secondsElapsed = (date.getTime() - Date.now()) / 1000;
   for (const key in ranges) {
      if (ranges[key] < Math.abs(secondsElapsed)) {
         const delta = secondsElapsed / ranges[key];
         return formatter.format(Math.round(delta), key as Intl.RelativeTimeFormatUnit);
      }
   }
};

/** * Formats a duration in seconds to a human-readable string
 * @param seconds - Duration in seconds
 */
export const formatDuration = (seconds: number): string => {
   if (!seconds) return '0s';

   if (seconds < 1) {
      return `${Math.round(seconds * 1000)}ms`;
   }

   const hours = Math.floor(seconds / 3600);
   const minutes = Math.floor((seconds % 3600) / 60);
   const remainingSeconds = Math.floor(seconds % 60);

   if (hours >= 1) {
      return `${hours} h ${minutes} min`;
   }

   if (minutes >= 1) {
      return `${minutes} min`;
   }

   return `${remainingSeconds}s`;
};

export const formatDateTime = (isoDate: string | number): string => {
   const date = new Date(isoDate);

   const options: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
   };

   return date.toLocaleString('en-US', options);
};

export const formatBytes = (bytes: number): string => {
   const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
   let value = bytes || 0;
   let unitIndex = 0;

   while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
   }

   return `${value.toFixed(2)} ${units[unitIndex]}`;
};

export const formatNumberToK = (num: number): string => {
   if (num < 1000) return num.toString();
   const value = num / 1000;
   return `${value.toFixed(1)}k`;
};

export const formatPermissions = (mode: number): string => {
   return (mode & 0o777).toString(8).padStart(3, '0');
};

export const formatSeconds = (num: number): string => {
   // should convert seconds to minutes, hours or days if applicable
   if (num >= 86400) {
      return `${Math.floor(num / 86400)}d`;
   }

   if (num >= 3600) {
      return `${Math.floor(num / 3600)}h`;
   }

   if (num >= 60) {
      return `${Math.floor(num / 60)}m`;
   }

   return `${Math.floor(num)}s`;
};

export const clipPath = (path: string, charsOnSide = 10) => {
   if (path.length <= charsOnSide * 2) return path;

   const start = path.slice(0, charsOnSide);
   const end = path.slice(-charsOnSide);

   return `${start}...${end}`;
};

export const getOSIcon = (os: string) => {
   const osString = os.toLowerCase();
   if (osString.includes('windows')) {
      return 'windows';
   }
   if (osString.includes('mac')) {
      return 'macos';
   }
   if (osString.includes('centos')) {
      return 'centos';
   }
   if (osString.includes('fedora')) {
      return 'fedora';
   }
   if (osString.includes('debian')) {
      return 'debian';
   }
   if (osString.includes('mint')) {
      return 'mint';
   }
   if (osString.includes('pop')) {
      return 'popos';
   }
   if (osString.includes('ubuntu')) {
      return 'ubuntu';
   }
   if (osString.includes('kali')) {
      return 'kali';
   }
   if (osString.includes('arch')) {
      return 'arch';
   }
   if (osString.includes('zorin')) {
      return 'zorin';
   }
   if (osString.includes('manjaro')) {
      return 'manjaro';
   }
   return 'linux';
};

export const getProcessorIcon = (brand: string) => {
   const osString = brand.toLowerCase();
   if (osString.includes('amd')) {
      return 'amd';
   }
   if (osString.includes('intel')) {
      return 'intel';
   }

   return 'processor';
};

export const compareVersions = (current: string, latest: string) => {
   if (!current || !latest) return false;
   const currentParts = current.split('.').map(Number);
   const latestParts = latest.split('.').map(Number);

   for (let i = 0; i < 3; i++) {
      const curr = currentParts[i] || 0;
      const late = latestParts[i] || 0;

      if (curr < late) return true;
      if (curr > late) return false;
   }
   return false;
};

export const isServerEdition = (distro: string, platform: string): boolean => {
   // Check Windows Server editions
   if (platform === 'win32') {
      return distro.includes('server') || distro.includes('windows server');
   }

   // Check Linux server distributions
   if (platform === 'linux') {
      return (
         distro.includes('server') ||
         distro.includes('enterprise') ||
         distro.includes('centos') ||
         distro.includes('redhat') ||
         distro.includes('ubuntu server') ||
         distro.includes('debian') ||
         distro.includes('fedora server')
      );
   }

   // Check macOS Server (though it's discontinued, some may still use it)
   if (platform === 'darwin') {
      return distro.includes('server');
   }

   return false;
};

export function getLogLevelName(level: number): string {
   switch (level) {
      case 10:
         return 'trace';
      case 20:
         return 'debug';
      case 30:
         return 'info';
      case 40:
         return 'warn';
      case 50:
         return 'error';
      case 60:
         return 'fatal';
      default:
         return 'unknown';
   }
}

/**
 * Validates if a string is a valid email address
 * @param email - The email string to validate
 * @returns boolean - True if email is valid, false otherwise
 */
export const isValidEmail = (email: string): boolean => {
   if (!email || typeof email !== 'string') {
      return false;
   }

   const trimmedEmail = email.trim();

   // Check length limits
   if (trimmedEmail.length === 0 || trimmedEmail.length > 254) {
      return false;
   }

   // More strict email regex that requires proper TLD
   const emailRegex =
      /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

   if (!emailRegex.test(trimmedEmail)) {
      return false;
   }

   // Split and validate local and domain parts
   const [localPart, domainPart] = trimmedEmail.split('@');

   // Validate local part (before @)
   if (!localPart || localPart.length > 64) {
      return false;
   }

   // Validate domain part (after @)
   if (!domainPart || domainPart.length > 253) {
      return false;
   }

   // Ensure domain has at least one dot and proper TLD
   if (!domainPart.includes('.')) {
      return false;
   }

   // Check TLD is at least 2 characters
   const domainParts = domainPart.split('.');
   const tld = domainParts[domainParts.length - 1];
   if (!tld || tld.length < 2) {
      return false;
   }

   // Check for invalid patterns
   if (
      localPart.startsWith('.') ||
      localPart.endsWith('.') ||
      localPart.includes('..') ||
      domainPart.startsWith('.') ||
      domainPart.endsWith('.') ||
      domainPart.includes('..')
   ) {
      return false;
   }

   return true;
};

export const shouldDisplayStorageField = (field: storageOptionField, settings: Record<string, any>, allFields: storageOptionField[]): boolean => {
   // If no conditions, always display the field
   if (!field.condition || field.condition.length === 0) {
      return true;
   }

   // A field is displayed if ANY of its conditions are fully satisfied
   return field.condition.some((condition) => {
      // A condition is satisfied if ALL its key-value pairs match
      return Object.entries(condition).every(([condKey, condValue]) => {
         // Find the field that this condition refers to
         const targetField = allFields.find((f) => f.value === condKey);
         if (!targetField) return false;

         // Get the current value from settings, or use the default
         const currentValue = settings[condKey] !== undefined ? settings[condKey] : targetField.default;

         // Check if the condition value matches the field's value
         return currentValue === condValue;
      });
   });
};

// Calculate the size of each directory based on its files
export const calculateDirectorySizes = (files: Pick<FileItem, 'path' | 'size' | 'isDirectory'>[]) => {
   const dirSizes: { [path: string]: number } = {};

   // Initialize all directories with size 0
   files.forEach((file) => {
      if (file.isDirectory) {
         dirSizes[file.path] = 0;
      }
   });

   // Sum up file sizes for each directory
   files.forEach((file) => {
      if (!file.isDirectory && file.size) {
         // For each file, add its size to all parent directories
         let pathParts = file.path.split('/').filter(Boolean);
         let currentPath = '';

         // Add size to each parent directory
         for (let i = 0; i < pathParts.length - 1; i++) {
            currentPath = currentPath ? `${currentPath}/${pathParts[i]}` : `/${pathParts[i]}`;
            if (dirSizes[currentPath] !== undefined) {
               dirSizes[currentPath] += file.size;
            }
         }
      }
   });

   return dirSizes;
};

export const sortFileItems = (items: FileItem[], sortField: keyof FileItem, sortDirection: 'asc' | 'desc') => {
   return [...items].sort((a, b) => {
      if (sortField === 'name') {
         const nameA = a.name.toLowerCase();
         const nameB = b.name.toLowerCase();
         return sortDirection === 'asc' ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA);
      } else if (sortField === 'modifiedAt') {
         const dateA = new Date(a.modifiedAt).getTime();
         const dateB = new Date(b.modifiedAt).getTime();
         return sortDirection === 'asc' ? dateA - dateB : dateB - dateA;
      } else if (sortField === 'size') {
         const sizeA = a.size || 0;
         const sizeB = b.size || 0;
         return sortDirection === 'asc' ? sizeA - sizeB : sizeB - sizeA;
      } else {
         const multiplier = sortDirection === 'asc' ? 1 : -1;
         const valueA = a[sortField]?.toString() || '';
         const valueB = b[sortField]?.toString() || '';
         return valueA.localeCompare(valueB) * multiplier;
      }
   });
};

export const getAvailableCliApps = (platform?: string) => {
   const availableShells: Record<string, { label: string; value: string }[]> = {
      Windows: [
         { label: 'PowerShell', value: 'powershell' },
         { label: 'Command Prompt (CMD)', value: 'cmd' },
         { label: 'Bash', value: 'bash' },
      ],
      MacOs: [
         { label: 'Zsh', value: 'zsh' },
         { label: 'Bash', value: '/bin/bash' },
         { label: 'sh', value: '/bin/sh' },
      ],
      Linux: [
         { label: 'Bash', value: '/bin/bash' },
         { label: 'sh', value: '/bin/sh' },
         { label: 'Zsh', value: 'zsh' },
      ],
   };
   type typeofOSType = keyof typeof availableShells;

   switch (platform) {
      case 'win32':
      case 'windows':
      case 'Windows':
         return availableShells.Windows;
      case 'darwin':
         return availableShells.MacOs;
      case 'linux':
      case 'Linux':
         return availableShells.Linux;
      default:
         const allShells: { label: string; value: string }[] = [];
         (Object.keys(availableShells) as typeofOSType[]).map((OSType) => {
            availableShells[OSType].forEach((shell) => {
               if (allShells.findIndex((s) => s.value === shell.value) === -1) {
                  allShells.push({ label: `${shell.label} (${shell.value})`, value: shell.value });
               }
            });
         });
         return allShells;
   }
};

export const secondsToMinutes = (seconds: number) => {
   if (seconds === 0) {
      return '';
   }
   return seconds > 60 ? `${Math.round(seconds / 60)} min` : `${seconds} sec`;
};
