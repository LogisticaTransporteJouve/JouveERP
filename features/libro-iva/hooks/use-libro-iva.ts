"use client";

import { useQuery } from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  listLibroIvaComprasAction,
  listLibroIvaVentasAction,
} from "../actions/libro-iva-actions";
import { libroIvaKeys } from "../lib/libro-iva-keys";

// useQuery (not useSuspenseQuery): the period and channel are chosen on the
// client, so we can't prefetch from the server. Next 16 forbids calling server
// actions during the initial render, which is what useSuspenseQuery triggers
// when there's no cached data (waterfall warning). With useQuery the action
// runs after mount and the table shows a skeleton while loading.

export function useLibroIvaVentas(period: string, channelId: string | null) {
  return useQuery({
    queryKey: libroIvaKeys.ventas(period, channelId),
    queryFn: () =>
      runAction(() =>
        listLibroIvaVentasAction({ period, channelId: channelId ?? undefined }),
      ),
  });
}

export function useLibroIvaCompras(period: string, channelId: string | null) {
  return useQuery({
    queryKey: libroIvaKeys.compras(period, channelId),
    queryFn: () =>
      runAction(() =>
        listLibroIvaComprasAction({ period, channelId: channelId ?? undefined }),
      ),
  });
}
