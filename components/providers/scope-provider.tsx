"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type Division = "dz" | "jouve";
export type FiscalFilter = "all" | "fiscal" | "internal";

export type Scope = {
  division: Division | null;
  fiscalFilter: FiscalFilter;
};

type ScopeContextValue = Scope & {
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
      division:
        parsed.division === "dz" || parsed.division === "jouve"
          ? parsed.division
          : null,
      fiscalFilter:
        parsed.fiscalFilter === "fiscal" || parsed.fiscalFilter === "internal"
          ? parsed.fiscalFilter
          : "all",
    };
  } catch {
    return DEFAULT_SCOPE;
  }
}

export function ScopeProvider({ children }: { children: React.ReactNode }) {
  const [scope, setScope] = useState<Scope>(DEFAULT_SCOPE);

  useEffect(() => {
    setScope(readFromStorage());
  }, []);

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
    () => ({ ...scope, setDivision, setFiscalFilter }),
    [scope, setDivision, setFiscalFilter],
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
