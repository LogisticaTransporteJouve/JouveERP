"use client";

import { useEffect, useRef } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";

import { createClient } from "@/lib/supabase/client";

type Subscription = {
  table: string;
  schema?: string;
  /** Optional Postgres-changes filter, e.g. `client_id=eq.<uuid>`. */
  filter?: string;
  /**
   * Query keys to invalidate on every event for this table. Each subscription
   * can target multiple keys (e.g. comprobantes events also invalidate
   * aging).
   */
  queryKeys: QueryKey[];
};

/**
 * Subscribes to Supabase realtime `postgres_changes` events on one or more
 * tables and invalidates the supplied TanStack Query keys whenever a row
 * is inserted, updated, or deleted.
 *
 * Why this hook:
 *   - The Supabase channel only respects RLS for rows the current user can
 *     SELECT, so subscribing from the browser is safe.
 *   - We bundle the `queryKeys` to invalidate alongside the table so each
 *     consumer (a list page) declares both pieces in one place.
 *   - Subscriptions are scoped to component lifetime — the channel is
 *     unsubscribed on unmount, so navigating between pages doesn't leak
 *     channels.
 *
 * The deps array intentionally omits `subscriptions` and `queryClient` —
 * we capture the latest values via a ref so the channel only opens once.
 * Re-running the effect on every render would tear down and rebuild the
 * websocket subscription on every keystroke that changes a sibling state.
 */
export function useRealtimeInvalidate(subscriptions: Subscription[]) {
  const queryClient = useQueryClient();
  const subsRef = useRef(subscriptions);
  subsRef.current = subscriptions;

  // Stable signature: identifies which tables / filters we listen to.
  // Reordering or changing the targeted tables rebuilds the channel; key
  // additions to existing tables don't.
  const signature = subscriptions
    .map((s) => `${s.schema ?? "public"}.${s.table}:${s.filter ?? ""}`)
    .sort()
    .join("|");

  useEffect(() => {
    if (subsRef.current.length === 0) return;
    const supabase = createClient();
    // Channel name only needs to be unique per browser tab, not globally.
    const channel = supabase.channel(
      `realtime-invalidate:${signature}:${Math.random().toString(36).slice(2, 8)}`,
    );

    for (let i = 0; i < subsRef.current.length; i++) {
      const sub = subsRef.current[i]!;
      channel.on(
        // The realtime client's typing for postgres_changes is loose; the
        // payload is unused so the cast is harmless.
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
      void supabase.removeChannel(channel);
    };
    // signature covers every primitive piece of the subscription list that
    // affects the channel topology; queryClient is stable from the provider.
  }, [signature, queryClient]);
}
