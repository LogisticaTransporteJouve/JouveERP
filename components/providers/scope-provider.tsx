"use client";

import {
  createContext,
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";

import {
  defaultChannelFor,
  isFiscalFor,
  parseFiscalFilter,
  SCOPE_COOKIE,
  serializeFiscalFilter,
  type FiscalFilter,
  type InvoicingChannelSummary,
} from "@/lib/scope";

type ScopeContextValue = {
  fiscalFilter: FiscalFilter;
  channels: InvoicingChannelSummary[];
  setFiscalFilter: (filter: FiscalFilter) => void;
};

const STORAGE_KEY = "jouve_scope_v1";

const ScopeContext = createContext<ScopeContextValue | null>(null);

function persist(filter: FiscalFilter) {
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

function readFromStorage(): FiscalFilter {
  if (typeof window === "undefined") return "all";
  try {
    return parseFiscalFilter(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return "all";
  }
}

export function ScopeProvider({
  channels,
  initialFiscalFilter,
  children,
}: {
  channels: InvoicingChannelSummary[];
  initialFiscalFilter?: FiscalFilter;
  children: React.ReactNode;
}) {
  // The server passes the filter read from the cookie in the layout,
  // avoiding the "all channels" flash during the first render.
  const [fiscalFilter, setFiscalFilterState] = useState<FiscalFilter>(
    initialFiscalFilter ?? "all",
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
    (filter: FiscalFilter) => {
      persist(filter);
      setFiscalFilterState(filter);
      router.refresh();
    },
    [router],
  );

  const value = useMemo<ScopeContextValue>(
    () => ({ fiscalFilter, channels, setFiscalFilter }),
    [fiscalFilter, channels, setFiscalFilter],
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

/** The read filter of the header scope, for list queries (`isFiscalFor`).
 *  Deferred so switching scope keeps the previous list on screen while the
 *  new one loads instead of suspending to the skeleton. */
/** The channel a new-record form pre-selects (`defaultChannelFor` over every
 *  channel): the scope's only active channel, else `null` and the user picks. */
export function useDefaultChannel(): string | null {
  const { fiscalFilter, channels } = useScope();
  return defaultChannelFor(fiscalFilter, channels);
}

export function useScopeIsFiscal(): boolean | null {
  const { fiscalFilter } = useScope();
  return useDeferredValue(isFiscalFor(fiscalFilter));
}
