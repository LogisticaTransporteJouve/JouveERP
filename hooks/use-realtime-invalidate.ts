"use client";

import { useEffect, useRef } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";

import { createClient } from "@/lib/supabase/client";

type Subscription = {
  table: string;
  schema?: string;
  /** Postgres-changes filter, e.g. `client_id=eq.<uuid>`. */
  filter?: string;
  queryKeys: QueryKey[];
};

// Subscribes to Supabase `postgres_changes` and invalidates the given
// TanStack Query keys on every insert/update/delete. RLS is enforced at
// the channel level, so browser subscribers only see rows they can SELECT.
//
// The effect depends on `signature` (table+schema+filter joined) instead
// of the raw subscriptions array so the channel doesn't tear down on
// every render. The latest queryKeys are read through `subsRef` at
// invalidation time.
//
// Invalidation is debounced (trailing, INVALIDATE_DEBOUNCE_MS): a bulk write
// (e.g. a receipt with 30 allocations, a billing run) fires one event per row,
// and invalidating on each one refetched the same queries dozens of times.
// Only queries currently rendered refetch (`refetchType: "active"`); inactive
// ones are just marked stale and refetch when next used.
const INVALIDATE_DEBOUNCE_MS = 500;

export function useRealtimeInvalidate(subscriptions: Subscription[]) {
  const queryClient = useQueryClient();
  const subsRef = useRef(subscriptions);
  subsRef.current = subscriptions;

  const signature = subscriptions
    .map((s) => `${s.schema ?? "public"}.${s.table}:${s.filter ?? ""}`)
    .sort()
    .join("|");

  useEffect(() => {
    if (subsRef.current.length === 0) return;
    const supabase = createClient();
    const channel = supabase.channel(
      `realtime-invalidate:${signature}:${Math.random().toString(36).slice(2, 8)}`,
    );

    const pending = new Set<number>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      for (const i of pending) {
        const current = subsRef.current[i];
        if (!current) continue;
        for (const key of current.queryKeys) {
          void queryClient.invalidateQueries({
            queryKey: key,
            refetchType: "active",
          });
        }
      }
      pending.clear();
    };

    for (let i = 0; i < subsRef.current.length; i++) {
      const sub = subsRef.current[i]!;
      channel.on(
        // Supabase's postgres_changes types don't compose cleanly with
        // dynamic table/filter values; the payload is unused either way.
        "postgres_changes" as never,
        {
          event: "*",
          schema: sub.schema ?? "public",
          table: sub.table,
          ...(sub.filter ? { filter: sub.filter } : {}),
        },
        () => {
          pending.add(i);
          if (timer !== null) clearTimeout(timer);
          timer = setTimeout(flush, INVALIDATE_DEBOUNCE_MS);
        },
      );
    }

    channel.subscribe();

    return () => {
      if (timer !== null) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [signature, queryClient]);
}
