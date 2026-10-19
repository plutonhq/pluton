export type RestoreEntry = { path: string; isDirectory: boolean; size: number; type?: string };
export type RestoreSelection = { includes: Set<string>; excludes: Set<string> };
const canonical = (path: string) => path.replace(/\\/g, '/').replace(/\/$/, '') || '/';
const contains = (parent: string, child: string) =>
   canonical(parent) === canonical(child) || canonical(child).startsWith(`${canonical(parent) === '/' ? '' : canonical(parent)}/`);

export function selectedRestorePaths(files: RestoreEntry[], selection: RestoreSelection): Set<string> {
   const includes = [...selection.includes],
      excludes = [...selection.excludes];
   const result = new Set(
      files
         .filter(
            (file) => (!includes.length || includes.some((path) => contains(path, file.path))) && !excludes.some((path) => contains(path, file.path)),
         )
         .map((file) => file.path),
   );
   // Necessary ancestor directories are entries, not additional regular files.
   for (const directory of files.filter((file) => file.isDirectory)) {
      if (files.some((file) => result.has(file.path) && contains(directory.path, file.path))) result.add(directory.path);
   }
   return result;
}

export function encodeRestoreSelection(files: RestoreEntry[], chosen: Set<string>): RestoreSelection {
   if (files.length && files.every((file) => chosen.has(file.path))) return { includes: new Set(), excludes: new Set() };
   if (!chosen.size) {
      return {
         includes: new Set(),
         excludes: new Set(
            files
               .filter((file) => !files.some((parent) => parent.isDirectory && parent.path !== file.path && contains(parent.path, file.path)))
               .map((file) => file.path),
         ),
      };
   }
   const complete = files.filter(
      (file) => chosen.has(file.path) && (!file.isDirectory || files.every((child) => !contains(file.path, child.path) || chosen.has(child.path))),
   );
   // Empty includes means ALL to Restic/the API. Ancestors alone are not a
   // selectable recursive subtree; never encode an empty leaf set as Select All.
   if (!complete.length) return encodeRestoreSelection(files, new Set());
   return {
      includes: new Set(
         complete
            .filter((file) => !complete.some((parent) => parent.isDirectory && parent.path !== file.path && contains(parent.path, file.path)))
            .map((file) => file.path),
      ),
      excludes: new Set(),
   };
}

export function restoreSelectionState(files: RestoreEntry[], selected: Set<string>, pathname: string): 'all' | 'partial' | 'none' {
   const subtree = files.filter((file) => contains(pathname, file.path));
   return subtree.length && subtree.every((file) => selected.has(file.path))
      ? 'all'
      : subtree.some((file) => selected.has(file.path))
        ? 'partial'
        : 'none';
}

export function toggleRestoreSelection(files: RestoreEntry[], selection: RestoreSelection, pathname: string): RestoreSelection {
   const selected = selectedRestorePaths(files, selection);
   const remove = restoreSelectionState(files, selected, pathname) === 'all';
   for (const file of files)
      if (contains(pathname, file.path)) {
         if (remove) selected.delete(file.path);
         else selected.add(file.path);
      }
   // Keep only ancestors still necessary for selected descendants.
   for (const directory of files.filter((file) => file.isDirectory)) {
      if (files.some((child) => child.path !== directory.path && selected.has(child.path) && contains(directory.path, child.path)))
         selected.add(directory.path);
   }
   return encodeRestoreSelection(files, selected);
}

export function restoreSelectionSummary(files: RestoreEntry[], selection: RestoreSelection) {
   const selected = selectedRestorePaths(files, selection);
   const regularFiles = files.filter((file) => !file.isDirectory && (!file.type || file.type === 'file')),
      directories = files.filter((file) => file.isDirectory);
   const otherEntries = files.filter((file) => !file.isDirectory && file.type && file.type !== 'file' && selected.has(file.path)).length;
   return {
      files: regularFiles.filter((file) => selected.has(file.path)).length,
      directories: directories.filter((file) => selected.has(file.path)).length,
      entries: files.filter((file) => selected.has(file.path)).length,
      totalFiles: regularFiles.length,
      totalDirectories: directories.length,
      totalEntries: files.length,
      ...(otherEntries ? { otherEntries } : {}),
      bytes: regularFiles.reduce((sum, file) => sum + (selected.has(file.path) ? file.size : 0), 0),
      totalBytes: regularFiles.reduce((sum, file) => sum + file.size, 0),
   };
}
