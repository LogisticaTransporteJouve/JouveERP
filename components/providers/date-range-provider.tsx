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
  isRangePreset,
  resolveRange,
  type DateRange,
  type RangePreset,
} from "@/lib/date-range";

const STORAGE_KEY = "jouve_date_range_v1";
const DEFAULT_PRESET: RangePreset = "current_month";

type Persisted = {
  preset: RangePreset;
  customFrom: string;
  customTo: string;
};

type DateRangeContextValue = {
  preset: RangePreset;
  customFrom: string;
  customTo: string;
  /** Resolved window. null when preset === "all" (no filter). */
  range: DateRange | null;
  setPreset: (next: RangePreset) => void;
  setCustom: (from: string, to: string) => void;
};

const DateRangeContext = createContext<DateRangeContextValue | null>(null);

function readFromStorage(): Persisted {
  if (typeof window === "undefined") {
    return { preset: DEFAULT_PRESET, customFrom: "", customTo: "" };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { preset: DEFAULT_PRESET, customFrom: "", customTo: "" };
    }
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return {
      preset: isRangePreset(parsed.preset) ? parsed.preset : DEFAULT_PRESET,
      customFrom: typeof parsed.customFrom === "string" ? parsed.customFrom : "",
      customTo: typeof parsed.customTo === "string" ? parsed.customTo : "",
    };
  } catch {
    return { preset: DEFAULT_PRESET, customFrom: "", customTo: "" };
  }
}

export function DateRangeProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<Persisted>({
    preset: DEFAULT_PRESET,
    customFrom: "",
    customTo: "",
  });

  useEffect(() => {
    setState(readFromStorage());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const setPreset = useCallback((next: RangePreset) => {
    setState((prev) => ({ ...prev, preset: next }));
  }, []);

  const setCustom = useCallback((from: string, to: string) => {
    setState((prev) => ({
      ...prev,
      preset: "custom",
      customFrom: from,
      customTo: to,
    }));
  }, []);

  const value = useMemo<DateRangeContextValue>(() => {
    const custom =
      state.customFrom && state.customTo
        ? { from: state.customFrom, to: state.customTo }
        : null;
    return {
      preset: state.preset,
      customFrom: state.customFrom,
      customTo: state.customTo,
      range: resolveRange(state.preset, custom),
      setPreset,
      setCustom,
    };
  }, [state, setPreset, setCustom]);

  return (
    <DateRangeContext.Provider value={value}>
      {children}
    </DateRangeContext.Provider>
  );
}

export function useDateRange() {
  const ctx = useContext(DateRangeContext);
  if (!ctx) {
    throw new Error("useDateRange must be used within DateRangeProvider");
  }
  return ctx;
}
