import { useEffect } from "react";
import { useTheme } from "next-themes";

export function ThemeCompatibility() {
  const { theme } = useTheme();
  useEffect(() => {
    if (theme !== "light" && theme !== "dark" && theme !== "system") return;
    try {
      localStorage.setItem("themeSetting", theme === "system" ? "auto" : theme);
    } catch {
      /* Storage can be disabled. */
    }
  }, [theme]);
  return null;
}
