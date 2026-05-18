"use client";

import { useQuery } from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  listLibroIvaComprasAction,
  listLibroIvaVentasAction,
} from "../actions/libro-iva-actions";
import { libroIvaKeys } from "../lib/libro-iva-keys";

// useQuery (no useSuspenseQuery): el período y channel se eligen en el cliente,
// no podemos prefetchear desde el server. Next 16 prohíbe llamar server actions
// durante el initial render que es lo que useSuspenseQuery dispara cuando no
// hay data cacheada (waterfall warning). Con useQuery la action corre después
// del mount y la tabla muestra skeleton mientras carga.

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
