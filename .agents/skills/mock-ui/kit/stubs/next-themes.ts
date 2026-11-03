// next-themes for the mock: the theme is the .dark class theme-boot.js manages.
import { useSyncExternalStore } from "react";

const KEY = "jouve-mock-theme";
const read = () => {
  if (typeof document === "undefined") return "system";
  try { return localStorage.getItem(KEY) || "system"; } catch { return "system"; }
};
const subscribe = (fn: () => void) => {
  const mo = new MutationObserver(fn);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => mo.disconnect();
};

export const useTheme = () => {
  const theme = useSyncExternalStore(subscribe, read, () => "system");
  return {
    theme,
    resolvedTheme: typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light",
    setTheme: (t: string) => {
      try { localStorage.setItem(KEY, t); } catch {}
      (window as any).__applyTheme?.();
    },
  };
};
export const ThemeProvider = ({ children }: any) => children;
