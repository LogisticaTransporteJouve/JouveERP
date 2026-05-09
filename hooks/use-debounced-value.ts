"use client";

import { useEffect, useState } from "react";

/**
 * Returns `value` after `delay` ms of inactivity. Restarting the timer on
 * every change. Useful for search inputs, where we want to delay the
 * downstream side-effect (network call, URL push) until the user pauses.
 */
export function useDebouncedValue<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
