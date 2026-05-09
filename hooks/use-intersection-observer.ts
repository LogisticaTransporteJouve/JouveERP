"use client";

import { useCallback, useEffect, useRef, type RefCallback } from "react";

/**
 * Calls `onIntersect` whenever the returned ref's element enters the
 * viewport. Re-attaches the observer if the ref node changes (e.g. across
 * re-renders) so list virtualisation/sentinel patterns work without manual
 * disconnect/connect cycles.
 *
 * Pass `enabled: false` to pause without unmounting the consumer.
 */
export function useIntersectionObserver<T extends Element>(
  onIntersect: () => void,
  options?: IntersectionObserverInit & { enabled?: boolean },
): RefCallback<T> {
  const callbackRef = useRef(onIntersect);
  callbackRef.current = onIntersect;

  const observerRef = useRef<IntersectionObserver | null>(null);
  const enabled = options?.enabled !== false;

  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, []);

  return useCallback(
    (node: T | null) => {
      observerRef.current?.disconnect();
      if (!node || !enabled) {
        observerRef.current = null;
        return;
      }
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            callbackRef.current();
          }
        },
        {
          root: options?.root,
          rootMargin: options?.rootMargin,
          threshold: options?.threshold,
        },
      );
      observer.observe(node);
      observerRef.current = observer;
    },
    [enabled, options?.root, options?.rootMargin, options?.threshold],
  );
}
