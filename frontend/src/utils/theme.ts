export type ThemeSetting = 'light' | 'dark' | 'auto';
export type AppliedTheme = 'light' | 'dark';
export const THEME_STORAGE_KEY = 'themeSetting';
export function validThemeSetting(value: unknown): value is ThemeSetting {
   return value === 'light' || value === 'dark' || value === 'auto';
}
export function readThemeSetting(storage: Pick<Storage, 'getItem'>): ThemeSetting {
   try {
      const value = storage.getItem(THEME_STORAGE_KEY) || storage.getItem('theme');
      return validThemeSetting(value) ? value : 'auto';
   } catch {
      return 'auto';
   }
}
export function persistThemeSetting(storage: Pick<Storage, 'setItem'>, setting: ThemeSetting): void {
   try {
      storage.setItem(THEME_STORAGE_KEY, setting);
   } catch {
      /* Restricted storage must not break the UI. */
   }
}
export function resolveTheme(setting: ThemeSetting, prefersDark: boolean): AppliedTheme {
   return setting === 'auto' ? (prefersDark ? 'dark' : 'light') : setting;
}
