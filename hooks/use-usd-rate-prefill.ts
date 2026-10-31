"use client";

import { useEffect, useRef } from "react";

/** The value to write into a cotización input, or null to leave it alone: the
 *  loaded rate when the input is empty or still holds the last prefill. */
export function usdRatePrefill(
  rate: number | null | undefined,
  value: string,
  lastPrefill: string | null,
): string | null {
  if (rate == null) return null;
  if (value !== "" && value !== lastPrefill) return null;
  return String(rate);
}

/**
 * Fills a cotización input with the loaded rate while the user has not typed
 * their own, so a date change refreshes a prefilled rate but never a typed one.
 */
export function useUsdRatePrefill(
  rate: number | null | undefined,
  value: string,
  setValue: (next: string) => void,
) {
  const lastPrefill = useRef<string | null>(null);
  useEffect(() => {
    const next = usdRatePrefill(rate, value, lastPrefill.current);
    if (next === null) return;
    lastPrefill.current = next;
    if (value !== next) setValue(next);
  }, [rate, value, setValue]);
}
