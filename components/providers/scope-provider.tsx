"use client";

import {
  Fragment,
  createContext,
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";

import {
  channelIsFiscal,
  defaultChannelFor,
  isFiscalFor,
  isScopedPath,
  parseFiscalFilter,
  SCOPE_COOKIE,
  serializeFiscalFilter,
  toScopeSide,
  type FiscalFilter,
  type InvoicingChannelSummary,
  type ScopeSide,
} from "@/lib/scope";

type ScopeContextValue = {
  /** The side the menu last switched to; it applies only on split pages. */
  fiscalFilter: ScopeSide;
  channels: InvoicingChannelSummary[];
  /** The scope cannot change (a fiscal-only user is pinned to fiscal). */
  locked: boolean;
  setFiscalFilter: (filter: ScopeSide) => void;
};

const STORAGE_KEY = "jouve_scope_v1";

const ScopeContext = createContext<ScopeContextValue | null>(null);

function persist(filter: ScopeSide) {
  if (typeof window === "undefined") return;
  const serialized = serializeFiscalFilter(filter);
  try {
    window.localStorage.setItem(STORAGE_KEY, serialized);
  } catch {
    // Storage blocked: the cookie below still carries the scope.
  }
  // Also a cookie, so the server renders and prefetches under this scope.
  document.cookie = `${SCOPE_COOKIE}=${encodeURIComponent(serialized)}; path=/; max-age=31536000; SameSite=Lax`;
}

function readFromStorage(): ScopeSide {
  if (typeof window === "undefined") return "fiscal";
  try {
    return toScopeSide(
      parseFiscalFilter(window.localStorage.getItem(STORAGE_KEY)),
    );
  } catch {
    return "fiscal";
  }
}

export function ScopeProvider({
  channels,
  initialFiscalFilter,
  locked = false,
  children,
}: {
  channels: InvoicingChannelSummary[];
  initialFiscalFilter?: ScopeSide;
  locked?: boolean;
  children: React.ReactNode;
}) {
  // The server passes the side read from the cookie in the layout, avoiding a
  // flash of the other side during the first render.
  const [fiscalFilter, setFiscalFilterState] = useState<ScopeSide>(
    initialFiscalFilter ?? "fiscal",
  );

  // We only hydrate from localStorage if the server didn't pass a filter
  // (the pre-cookie case in old sessions).
  useEffect(() => {
    if (initialFiscalFilter) return;
    setFiscalFilterState(readFromStorage());
  }, [initialFiscalFilter]);

  useEffect(() => {
    persist(fiscalFilter);
  }, [fiscalFilter]);

  const router = useRouter();
  // The cookie is written before the refresh so server components (the
  // dashboard, page prefetches) re-render under the new scope.
  const setFiscalFilter = useCallback(
    (filter: ScopeSide) => {
      if (locked) return;
      persist(filter);
      setFiscalFilterState(filter);
      router.refresh();
    },
    [locked, router],
  );

  const value = useMemo<ScopeContextValue>(
    () => ({ fiscalFilter, channels, locked, setFiscalFilter }),
    [fiscalFilter, channels, locked, setFiscalFilter],
  );

  return (
    <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>
  );
}

export function useScope() {
  const ctx = useContext(ScopeContext);
  if (!ctx) {
    throw new Error("useScope must be used within ScopeProvider");
  }
  return ctx;
}

const PageSideContext = createContext<ScopeSide | null>(null);

/** Pins the side of everything below it to a record's own side (a client's or
 *  supplier's detail page, a fiscal document), whatever the menu last chose. */
export function PageSideProvider({
  side,
  children,
}: {
  side: ScopeSide;
  children: React.ReactNode;
}) {
  return (
    <PageSideContext.Provider value={side}>{children}</PageSideContext.Provider>
  );
}

/** The scope a page reads: a pinned record's side (PageSideProvider), else the
 *  menu's side on a split page (Ventas, Compras and their "Otras"), every
 *  channel on a shared one (treasury, dashboard…). A fiscal-only user is
 *  always fiscal. */
export function usePageScope(): FiscalFilter {
  const { fiscalFilter, locked } = useScope();
  const pinned = useContext(PageSideContext);
  const pathname = usePathname();
  if (locked) return "fiscal";
  if (pinned) return pinned;
  return isScopedPath(pathname) ? fiscalFilter : "all";
}

/** The channel a new-record form pre-selects (`defaultChannelFor`): the page
 *  scope's only active channel, else `null` and the user picks. */
export function useDefaultChannel(): string | null {
  const { channels } = useScope();
  return defaultChannelFor(usePageScope(), channels);
}

/** The read filter of the page scope, for list queries (`isFiscalFor`).
 *  Deferred so switching side keeps the previous list on screen while the new
 *  one loads instead of suspending to the skeleton. */
export function useScopeIsFiscal(): boolean | null {
  return useDeferredValue(isFiscalFor(usePageScope()));
}

/** The page's side for a form: true on Ventas/Compras, false on their "Otras",
 *  null on a shared page (treasury…), where both sides apply. */
export function usePageIsFiscal(): boolean | null {
  return isFiscalFor(usePageScope());
}

/** The options of a channel select, kept to the page's side (all of them on a
 *  shared page), so a form cannot mix a side's counterparty with the other's
 *  channel. */
export function useSideChannels<T extends { id: string }>(
  options: readonly T[],
): T[] {
  const { channels } = useScope();
  const isFiscal = usePageIsFiscal();
  return useMemo(
    () =>
      isFiscal === null
        ? [...options]
        : options.filter((o) => channelIsFiscal(o.id, channels) === isFiscal),
    [options, channels, isFiscal],
  );
}

/** Remounts the page when the menu switches side: Ventas › Comprobantes and
 *  Otras ventas › Comprobantes share a URL, and list state (filters, open
 *  dialogs) from one side must not carry over to the other. */
export function SideKeyed({ children }: { children: React.ReactNode }) {
  const { fiscalFilter } = useScope();
  return <Fragment key={fiscalFilter}>{children}</Fragment>;
}
