import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';

type ThemeSetting = 'light' | 'dark' | 'auto';
type AppliedTheme = 'light' | 'dark';

type ThemeContextType = {
   theme: AppliedTheme;
   setTheme: (themeSetting: ThemeSetting) => void;
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// A helper function to read the initial state from localStorage
const getInitialThemeSetting = (): ThemeSetting => {
   if (typeof window === 'undefined') {
      return 'auto';
   }
   const storedTheme = window.localStorage.getItem('themeSetting');
   if (storedTheme === 'light' || storedTheme === 'dark' || storedTheme === 'auto') {
      return storedTheme;
   }
   return 'auto'; // Default to 'auto'
};

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
   // Initialize state directly from localStorage
   const [themeSetting, setThemeSetting] = useState<ThemeSetting>(getInitialThemeSetting);
   const [appliedTheme, setAppliedTheme] = useState<AppliedTheme>('light');

   // This effect applies the theme to the DOM and listens for system changes
   useEffect(() => {
      const applyTheme = (t: AppliedTheme) => {
         document.documentElement.setAttribute('data-theme', t);
         setAppliedTheme(t);
      };

      if (themeSetting === 'auto') {
         const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
         applyTheme(mediaQuery.matches ? 'dark' : 'light');

         const handleChange = (e: MediaQueryListEvent) => {
            applyTheme(e.matches ? 'dark' : 'light');
         };

         mediaQuery.addEventListener('change', handleChange);
         return () => mediaQuery.removeEventListener('change', handleChange);
      } else {
         applyTheme(themeSetting);
      }
   }, [themeSetting]);

   // This is the function that will be exposed to other components
   const handleSetTheme = useCallback((newSetting: ThemeSetting) => {
      // Persist the user's *choice* to localStorage
      localStorage.setItem('themeSetting', newSetting);
      setThemeSetting(newSetting);
   }, []);

   return <ThemeContext.Provider value={{ theme: appliedTheme, setTheme: handleSetTheme }}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => {
   const context = useContext(ThemeContext);
   if (context === undefined) {
      throw new Error('useTheme must be used within a ThemeProvider');
   }
   return context;
};
