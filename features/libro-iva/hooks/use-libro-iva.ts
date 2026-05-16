"use client";

import { useSuspenseQuery } from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import { listLibroIvaVentasAction } from "../actions/libro-iva-actions";
import { libroIvaKeys } from "../lib/libro-iva-keys";

export function useLibroIvaVentas(period: string, channelId: string | null) {
  return useSuspenseQuery({
    queryKey: libroIvaKeys.ventas(period, channelId),
    queryFn: () =>
      runAction(() =>
        listLibroIvaVentasAction({ period, channelId: channelId ?? undefined }),
      ),
  });
}
