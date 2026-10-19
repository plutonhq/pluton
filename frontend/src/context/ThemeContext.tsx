import { createContext, useContext, useState, useLayoutEffect, ReactNode, useCallback } from 'react';
import { readThemeSetting, persistThemeSetting, resolveTheme } from '../utils/theme';
import type { ThemeSetting, AppliedTheme } from '../utils/theme';

type ThemeContextType = {
   theme: AppliedTheme;
   themeSetting: ThemeSetting;
   setTheme: (themeSetting: ThemeSetting) => void;
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// A helper function to read the initial state from localStorage
const getInitialThemeSetting = (): ThemeSetting => {
   if (typeof window === 'undefined') {
      return 'auto';
   }
   try {
      return readThemeSetting(window.localStorage);
   } catch {
      return 'auto';
   }
};

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
   // Initialize state directly from localStorage
   const [themeSetting, setThemeSetting] = useState<ThemeSetting>(getInitialThemeSetting);
   const [appliedTheme, setAppliedTheme] = useState<AppliedTheme>(() =>
      resolveTheme(getInitialThemeSetting(), typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches),
   );

   // This effect applies the theme to the DOM and listens for system changes
   useLayoutEffect(() => {
      const applyTheme = (t: AppliedTheme) => {
         document.documentElement.setAttribute('data-theme', t);
         setAppliedTheme(t);
      };

      if (themeSetting === 'auto' && window.matchMedia) {
         const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
         applyTheme(mediaQuery.matches ? 'dark' : 'light');

         const handleChange = (e: MediaQueryListEvent) => {
            applyTheme(e.matches ? 'dark' : 'light');
         };

         mediaQuery.addEventListener('change', handleChange);
         return () => mediaQuery.removeEventListener('change', handleChange);
      } else {
         applyTheme(resolveTheme(themeSetting, false));
      }
   }, [themeSetting]);

   // This is the function that will be exposed to other components
   const handleSetTheme = useCallback((newSetting: ThemeSetting) => {
      // Persist the user's *choice* to localStorage
      try {
         persistThemeSetting(localStorage, newSetting);
      } catch {
         /* Browser storage may be disabled. */
      }
      setThemeSetting(newSetting);
   }, []);

   return <ThemeContext.Provider value={{ theme: appliedTheme, themeSetting, setTheme: handleSetTheme }}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => {
   const context = useContext(ThemeContext);
   if (context === undefined) {
      throw new Error('useTheme must be used within a ThemeProvider');
   }
   return context;
};
