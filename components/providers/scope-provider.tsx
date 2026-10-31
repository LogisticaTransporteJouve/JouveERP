"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
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
    if (typeof window === "undefined") return;
    const serialized = serializeFiscalFilter(fiscalFilter);
    try {
      window.localStorage.setItem(STORAGE_KEY, serialized);
    } catch {
      // Storage blocked: the cookie below still carries the scope.
    }
    // We also persist to a cookie for SSR on the next navigation.
    document.cookie = `${SCOPE_COOKIE}=${encodeURIComponent(serialized)}; path=/; max-age=31536000; SameSite=Lax`;
  }, [fiscalFilter]);

  const setFiscalFilter = useCallback((filter: FiscalFilter) => {
    setFiscalFilterState(filter);
  }, []);

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
