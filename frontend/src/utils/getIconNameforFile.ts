import { extensions } from './supportedExtensions';

// We only care about 'icon' and 'extensions' from the rules now
interface ISimpleExtensionIcon {
   icon: string;
   extensions?: string[];
   filename?: boolean; // Still needed to *filter* rules
   filenamesGlob?: string[]; // Still needed to *filter* rules
   disabled?: boolean;
   // Other fields are ignored for mapping
}

// --- End Type Definitions ---

// --- LOOKUP TABLE ---
// Simple map: lowercase extension -> icon name
const simpleExtensionToIconNameMap = new Map<string, string>();

// --- CONSTANTS ---
const DEFAULT_ICON_NAME: string = extensions.default?.file?.icon ? extensions.default.file.icon : 'file';

// --- HELPER FUNCTION ---
const getFileExtension = (filename: string): string => {
   if (!filename || typeof filename !== 'string') return '';
   const lastDot = filename.lastIndexOf('.');
   if (lastDot === -1 || lastDot === 0 || lastDot === filename.length - 1) {
      return '';
   }
   return filename.substring(lastDot + 1).toLowerCase();
};

// --- SIMPLIFIED INITIALIZATION LOGIC ---
function initializeSimpleIconMappings(): void {
   simpleExtensionToIconNameMap.clear();

   // Iterate through rules ONCE
   (extensions.supported || []).forEach((item: ISimpleExtensionIcon) => {
      // Skip disabled rules or rules meant for specific filenames/patterns
      if (item.disabled || item.filename || item.filenamesGlob || !item.icon || !item.extensions) {
         return;
      }

      const iconName = item.icon;

      // Map extensions from this generic rule
      item.extensions.forEach((ext: string) => {
         const cleanExt = ext.toLowerCase().replace(/^\./, '');
         if (cleanExt) {
            // First rule encountered for an extension wins
            if (!simpleExtensionToIconNameMap.has(cleanExt)) {
               simpleExtensionToIconNameMap.set(cleanExt, iconName);
            }
         }
      });
   });

   // *** Explicit Overrides for Common/Ambiguous Types ***
   // Ensure common types map correctly, overriding any conflicts from earlier rules.
   const overrides: { [key: string]: string[] } = {
      image: ['jpeg', 'jpg', 'gif', 'png', 'bmp', 'tiff', 'heic', 'ico', 'icns', 'webp', 'avif'],
      text: ['txt'],
      json: ['json', 'jsonc', 'jsonl'],
      yaml: ['yaml', 'yml'],
      xml: ['xml', 'xsd', 'xsl', 'xslt'],
      pdf: ['pdf'],
      word: ['doc', 'docx', 'docm', 'dot', 'dotx', 'dotm', 'wll'],
      excel: ['xls', 'xlsx', 'xlsm', 'ods', 'fods', 'xlsb'],
      powerpoint: ['ppt', 'pptx', 'pps', 'ppsx', 'pot', 'potx'],
      zip: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'],
      audio: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'],
      video: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'flv'],
      font: ['woff', 'woff2', 'ttf', 'otf', 'eot'],
      markdown: ['md', 'markdown', 'mdown'],
      css: ['css'],
      html: ['html', 'htm'],
      js: ['js', 'cjs', 'mjs'],
      typescript: ['ts', 'cts', 'mts'],
      reactts: ['tsx'],
      docker: ['dockerignore', 'Dockerfile'],
      git: ['gitignore', 'gitattributes', 'gitmodules'],
      eslint: ['eslintignore', 'eslintrc'],
      toml: ['toml'],
   };

   for (const iconName in overrides) {
      overrides[iconName].forEach((ext) => {
         const cleanExt = ext.toLowerCase().replace(/^\./, '');
         if (cleanExt) {
            simpleExtensionToIconNameMap.set(cleanExt, iconName);
         }
      });
   }

   // console.log("Simple Extension Map Initialized:", simpleExtensionToIconNameMap);
}

initializeSimpleIconMappings();

// --- SIMPLIFIED RESOLVER FUNCTION ---
export function getIconNameForFile(filename?: string | null): string {
   if (!filename) {
      return DEFAULT_ICON_NAME;
   }

   // Get the actual filename part, lowercased (e.g., '.gitignore', 'dockerfile', 'myfile.txt')
   const baseFilenameLower = getBaseFilename(filename).toLowerCase();

   // --- Check 1: Match filename-like keys added via overrides ---

   // First, check using the exact base filename (handles 'dockerfile')
   if (simpleExtensionToIconNameMap.has(baseFilenameLower)) {
      return simpleExtensionToIconNameMap.get(baseFilenameLower)!;
   }

   // Second, if it starts with a dot, check using the name *without* the dot
   // (handles '.gitignore' lookup using the 'gitignore' key from overrides)
   if (baseFilenameLower.startsWith('.')) {
      const nameWithoutDot = baseFilenameLower.substring(1);
      if (simpleExtensionToIconNameMap.has(nameWithoutDot)) {
         // Found a match for the dotless version (like 'gitignore')
         return simpleExtensionToIconNameMap.get(nameWithoutDot)!;
      }
   }

   // --- Check 2: Match by actual file extension ---
   const extension = getFileExtension(filename); // Extracts 'txt', 'js', etc. Returns '' for '.gitignore'
   if (extension && simpleExtensionToIconNameMap.has(extension)) {
      // Found a match based on the extension (like 'txt' -> 'text')
      return simpleExtensionToIconNameMap.get(extension)!;
   }

   // --- Fallback: Default Icon ---
   return DEFAULT_ICON_NAME;
}

// Ensure getBaseFilename and getFileExtension helpers are present and correct
const getBaseFilename = (filenameWithMaybePath: string): string => {
   if (!filenameWithMaybePath || typeof filenameWithMaybePath !== 'string') return '';
   const lastSlash = Math.max(filenameWithMaybePath.lastIndexOf('/'), filenameWithMaybePath.lastIndexOf('\\'));
   // Return filename including leading dot if present
   return filenameWithMaybePath.substring(lastSlash + 1);
};
