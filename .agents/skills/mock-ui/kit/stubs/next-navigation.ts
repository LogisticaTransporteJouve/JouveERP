// next/navigation for the mock: the pathname is the mock's current route (set by shell.update),
// so AppSidebar's active item and AppHeader's breadcrumb follow the mock as they follow the app.
import { useSyncExternalStore } from "react";

let current = "/dashboard";
const listeners = new Set<() => void>();
export function setMockPath(path: string) {
  if (path === current) return;
  current = path;
  listeners.forEach((fn) => fn());
}
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const read = () => current;

const w = () => (typeof window === "undefined" ? ({} as any) : (window as any));
export const usePathname = () => useSyncExternalStore(subscribe, read, read);
export const useRouter = () => ({
  push: (u: string) => w().Mock?.shell?.(u),
  replace: (u: string) => w().Mock?.shell?.(u),
  refresh: () => {},
  back: () => {},
  forward: () => {},
  prefetch: () => {},
});
export const useSearchParams = () => new URLSearchParams();
export const useParams = () => ({});
export const redirect = () => {};
export const notFound = () => {};
