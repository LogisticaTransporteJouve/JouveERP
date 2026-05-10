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
          const current = subsRef.current[i];
          if (!current) return;
          for (const key of current.queryKeys) {
            queryClient.invalidateQueries({ queryKey: key });
          }
        },
      );
    }

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [signature, queryClient]);
}
