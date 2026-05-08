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
  isDivision,
  isFiscalFilter,
  type Division,
  type FiscalFilter,
  type InvoicingChannelSummary,
  type Scope,
} from "@/lib/scope";

type ScopeContextValue = Scope & {
  channels: InvoicingChannelSummary[];
  setDivision: (division: Division | null) => void;
  setFiscalFilter: (filter: FiscalFilter) => void;
};

const STORAGE_KEY = "jouve_scope_v1";
const DEFAULT_SCOPE: Scope = { division: null, fiscalFilter: "all" };

const ScopeContext = createContext<ScopeContextValue | null>(null);

function readFromStorage(): Scope {
  if (typeof window === "undefined") return DEFAULT_SCOPE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SCOPE;
    const parsed = JSON.parse(raw) as Partial<Scope>;
    return {
      division: isDivision(parsed.division) ? parsed.division : null,
      fiscalFilter: isFiscalFilter(parsed.fiscalFilter)
        ? parsed.fiscalFilter
        : "all",
    };
  } catch {
    return DEFAULT_SCOPE;
  }
}

export function ScopeProvider({
  channels,
  children,
}: {
  channels: InvoicingChannelSummary[];
  children: React.ReactNode;
}) {
  const [scope, setScope] = useState<Scope>(DEFAULT_SCOPE);

  // Hydrate from localStorage after mount; drop any persisted division that
  // no longer maps to an active channel.
  useEffect(() => {
    const stored = readFromStorage();
    const activeDivisions = new Set(
      channels.filter((c) => c.is_active).map((c) => c.division),
    );
    if (stored.division && !activeDivisions.has(stored.division)) {
      setScope({ ...stored, division: null });
    } else {
      setScope(stored);
    }
  }, [channels]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(scope));
  }, [scope]);

  const setDivision = useCallback((division: Division | null) => {
    setScope((prev) => ({ ...prev, division }));
  }, []);

  const setFiscalFilter = useCallback((fiscalFilter: FiscalFilter) => {
    setScope((prev) => ({ ...prev, fiscalFilter }));
  }, []);

  const value = useMemo<ScopeContextValue>(
    () => ({ ...scope, channels, setDivision, setFiscalFilter }),
    [scope, channels, setDivision, setFiscalFilter],
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
